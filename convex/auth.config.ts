export default {
  providers: [
    {
      domain: "https://clerk.nomorebadhaircuts.com",
      applicationID: "convex",
    },
    // Dev instance — used when running locally against the dev Convex deployment
    {
      domain: "https://full-sparrow-61.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
};