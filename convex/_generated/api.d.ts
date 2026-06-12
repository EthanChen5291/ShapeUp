/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as facelifts from "../facelifts.js";
import type * as gpuUsage from "../gpuUsage.js";
import type * as http from "../http.js";
import type * as lib_contentFilter from "../lib/contentFilter.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as projects from "../projects.js";
import type * as rateLimits from "../rateLimits.js";
import type * as sessions from "../sessions.js";
import type * as stripe from "../stripe.js";
import type * as users from "../users.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  facelifts: typeof facelifts;
  gpuUsage: typeof gpuUsage;
  http: typeof http;
  "lib/contentFilter": typeof lib_contentFilter;
  "lib/rateLimit": typeof lib_rateLimit;
  projects: typeof projects;
  rateLimits: typeof rateLimits;
  sessions: typeof sessions;
  stripe: typeof stripe;
  users: typeof users;
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
