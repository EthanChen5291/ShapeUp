/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as barberBatch from "../barberBatch.js";
import type * as barberBooking from "../barberBooking.js";
import type * as barberPages from "../barberPages.js";
import type * as barberTryOn from "../barberTryOn.js";
import type * as contact from "../contact.js";
import type * as facelifts from "../facelifts.js";
import type * as feedback from "../feedback.js";
import type * as freeGen from "../freeGen.js";
import type * as gpuUsage from "../gpuUsage.js";
import type * as http from "../http.js";
import type * as imageEditUsage from "../imageEditUsage.js";
import type * as lib_adminAuth from "../lib/adminAuth.js";
import type * as lib_allowlist from "../lib/allowlist.js";
import type * as lib_barberBatch from "../lib/barberBatch.js";
import type * as lib_barberEmail from "../lib/barberEmail.js";
import type * as lib_barberInsights from "../lib/barberInsights.js";
import type * as lib_barberLinks from "../lib/barberLinks.js";
import type * as lib_bookingSlots from "../lib/bookingSlots.js";
import type * as lib_calendarLinks from "../lib/calendarLinks.js";
import type * as lib_contentFilter from "../lib/contentFilter.js";
import type * as lib_disposableEmail from "../lib/disposableEmail.js";
import type * as lib_freeGen from "../lib/freeGen.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_referrals from "../lib/referrals.js";
import type * as phoneBonus from "../phoneBonus.js";
import type * as projects from "../projects.js";
import type * as rateLimits from "../rateLimits.js";
import type * as redeem from "../redeem.js";
import type * as refunds from "../refunds.js";
import type * as renderStations from "../renderStations.js";
import type * as sessions from "../sessions.js";
import type * as stripe from "../stripe.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  barberBatch: typeof barberBatch;
  barberBooking: typeof barberBooking;
  barberPages: typeof barberPages;
  barberTryOn: typeof barberTryOn;
  contact: typeof contact;
  facelifts: typeof facelifts;
  feedback: typeof feedback;
  freeGen: typeof freeGen;
  gpuUsage: typeof gpuUsage;
  http: typeof http;
  imageEditUsage: typeof imageEditUsage;
  "lib/adminAuth": typeof lib_adminAuth;
  "lib/allowlist": typeof lib_allowlist;
  "lib/barberBatch": typeof lib_barberBatch;
  "lib/barberEmail": typeof lib_barberEmail;
  "lib/barberInsights": typeof lib_barberInsights;
  "lib/barberLinks": typeof lib_barberLinks;
  "lib/bookingSlots": typeof lib_bookingSlots;
  "lib/calendarLinks": typeof lib_calendarLinks;
  "lib/contentFilter": typeof lib_contentFilter;
  "lib/disposableEmail": typeof lib_disposableEmail;
  "lib/freeGen": typeof lib_freeGen;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/referrals": typeof lib_referrals;
  phoneBonus: typeof phoneBonus;
  projects: typeof projects;
  rateLimits: typeof rateLimits;
  redeem: typeof redeem;
  refunds: typeof refunds;
  renderStations: typeof renderStations;
  sessions: typeof sessions;
  stripe: typeof stripe;
  users: typeof users;
  validators: typeof validators;
  waitlist: typeof waitlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
