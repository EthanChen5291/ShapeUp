terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ─────────────────────────────────────────
# Variables
# ─────────────────────────────────────────

variable "project_id" {
  default = "shape-up-gcp"
}

variable "region" {
  default = "us-central1"
}

variable "zone" {
  default = "us-central1-a"
}

variable "worker_image" {
  description = "Full image URL for the GPU worker container (pushed to Artifact Registry)"
  # e.g. us-central1-docker.pkg.dev/shape-up-gcp/shapeup/worker:latest
}

variable "trigger_image" {
  description = "Full image URL for the Cloud Run trigger container"
  # e.g. us-central1-docker.pkg.dev/shape-up-gcp/shapeup/trigger:latest
}

# ─────────────────────────────────────────
# Enable APIs
# ─────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "pubsub.googleapis.com",
    "storage.googleapis.com",
    "compute.googleapis.com",
    "artifactregistry.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# ─────────────────────────────────────────
# Service Accounts
# ─────────────────────────────────────────

resource "google_service_account" "trigger_sa" {
  account_id   = "shapeup-trigger"
  display_name = "ShapeUp Cloud Run Trigger"
}

resource "google_service_account" "worker_sa" {
  account_id   = "shapeup-worker"
  display_name = "ShapeUp GPU Worker"
}

# Trigger: publish to Pub/Sub + write to GCS
resource "google_project_iam_member" "trigger_pubsub" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.trigger_sa.email}"
}

resource "google_project_iam_member" "trigger_gcs" {
  project = var.project_id
  role    = "roles/storage.objectCreator"
  member  = "serviceAccount:${google_service_account.trigger_sa.email}"
}

# Trigger: read outputs to generate signed URLs
resource "google_project_iam_member" "trigger_gcs_viewer" {
  project = var.project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${google_service_account.trigger_sa.email}"
}

# Worker: subscribe to Pub/Sub + read/write GCS
resource "google_project_iam_member" "worker_pubsub" {
  project = var.project_id
  role    = "roles/pubsub.subscriber"
  member  = "serviceAccount:${google_service_account.worker_sa.email}"
}

resource "google_project_iam_member" "worker_gcs" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.worker_sa.email}"
}

# ─────────────────────────────────────────
# Cloud Storage
# ─────────────────────────────────────────

resource "google_storage_bucket" "data" {
  name                        = "shape-up-data-bucket"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  lifecycle_rule {
    condition { age = 7 }
    action { type = "Delete" }
  }
}

# ─────────────────────────────────────────
# Pub/Sub
# ─────────────────────────────────────────

resource "google_pubsub_topic" "jobs" {
  name = "shapeup-jobs"
}

resource "google_pubsub_subscription" "worker" {
  name  = "worker-subscription"
  topic = google_pubsub_topic.jobs.name

  ack_deadline_seconds       = 600  # 10 min — give the GPU time to finish
  message_retention_duration = "86400s"

  retry_policy {
    minimum_backoff = "30s"
    maximum_backoff = "300s"
  }
}

# ─────────────────────────────────────────
# Cloud Run (Trigger)
# ─────────────────────────────────────────

resource "google_cloud_run_v2_service" "trigger" {
  name     = "shapeup-trigger"
  location = var.region

  template {
    service_account = google_service_account.trigger_sa.email

    containers {
      image = var.trigger_image

      env {
        name  = "TOPIC_ID"
        value = google_pubsub_topic.jobs.name
      }
      env {
        name  = "BUCKET_NAME"
        value = google_storage_bucket.data.name
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }
  }

  depends_on = [google_project_service.apis]
}

# Allow unauthenticated public access to Cloud Run
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.trigger.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─────────────────────────────────────────
# Static IP + Load Balancer (permanent endpoint)
# ─────────────────────────────────────────

resource "google_compute_global_address" "api_ip" {
  name = "shapeup-api-static-ip"
}

resource "google_compute_region_network_endpoint_group" "trigger_neg" {
  name                  = "shapeup-trigger-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = google_cloud_run_v2_service.trigger.name
  }
}

resource "google_compute_backend_service" "trigger_backend" {
  name                  = "shapeup-trigger-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.trigger_neg.id
  }
}

resource "google_compute_url_map" "api" {
  name            = "shapeup-api-url-map"
  default_service = google_compute_backend_service.trigger_backend.id
}

resource "google_compute_managed_ssl_certificate" "api" {
  name = "shapeup-api-cert"
  managed {
    # Replace with your actual domain once DNS is pointed at the static IP
    domains = ["api.shape-up.app"]
  }
}

resource "google_compute_target_https_proxy" "api" {
  name             = "shapeup-api-https-proxy"
  url_map          = google_compute_url_map.api.id
  ssl_certificates = [google_compute_managed_ssl_certificate.api.id]
}

resource "google_compute_global_forwarding_rule" "api" {
  name                  = "shapeup-api-forwarding-rule"
  ip_address            = google_compute_global_address.api_ip.address
  port_range            = "443"
  target                = google_compute_target_https_proxy.api.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# ─────────────────────────────────────────
# GPU Worker — Managed Instance Group
# ─────────────────────────────────────────

resource "google_compute_instance_template" "worker" {
  name_prefix  = "shapeup-worker-"
  machine_type = "g2-standard-4"   # 1× NVIDIA L4
  region       = var.region

  scheduling {
    preemptible        = true   # Spot VM — ~70-90% cheaper
    automatic_restart  = false
    on_host_maintenance = "TERMINATE"
    provisioning_model = "SPOT"
  }

  guest_accelerator {
    type  = "nvidia-l4"
    count = 1
  }

  disk {
    source_image = "projects/cos-cloud/global/images/family/cos-stable"
    auto_delete  = true
    boot         = true
    disk_size_gb = 50
  }

  network_interface {
    network = "default"
    access_config {}  # ephemeral public IP so it can pull from Artifact Registry
  }

  service_account {
    email  = google_service_account.worker_sa.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    "install-nvidia-driver" = "true"
    "startup-script" = <<-EOT
      #!/bin/bash
      # Wait for NVIDIA driver installation by the COS helper
      for i in $(seq 1 30); do
        nvidia-smi && break
        sleep 10
      done

      # Pull and run the worker container
      docker run -d --restart=always \
        --gpus all \
        --name shapeup-worker \
        ${var.worker_image}
    EOT
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.apis]
}

resource "google_compute_instance_group_manager" "worker" {
  name               = "shapeup-worker-mig"
  base_instance_name = "shapeup-worker"
  zone               = var.zone

  version {
    instance_template = google_compute_instance_template.worker.id
  }

  # Serial processing: exactly one GPU worker at a time
  target_size = 1

  auto_healing_policies {
    health_check      = google_compute_health_check.worker.id
    initial_delay_sec = 300
  }
}

resource "google_compute_health_check" "worker" {
  name               = "shapeup-worker-health"
  check_interval_sec = 30
  timeout_sec        = 10

  tcp_health_check {
    port = 8080
  }
}

# ─────────────────────────────────────────
# Artifact Registry (image storage)
# ─────────────────────────────────────────

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "shapeup"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# ─────────────────────────────────────────
# Outputs
# ─────────────────────────────────────────

output "static_ip" {
  value       = google_compute_global_address.api_ip.address
  description = "Point your DNS A record here"
}

output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "cloud_run_url" {
  value = google_cloud_run_v2_service.trigger.uri
}
