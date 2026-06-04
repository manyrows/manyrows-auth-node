// Public surface of @manyrows/manyrows-auth-node.

export { ManyRowsServer, ManyRowsServerError } from "./client.js";
export type {
  ManyRowsServerOptions,
  UserSource,
  User,
  UserFieldValue,
  ServerUser,
  Member,
  MembersList,
  CheckPermissionResult,
  RoleSummary,
  PermissionSummary,
  CreateUserInput,
  CreateUserResult,
  BatchUserResult,
  AppUserStatus,
  UserStatusResult,
  RemoveUserResult,
  MagicLinkResult,
  Session,
  AuthLogEntry,
  AuthLogsPage,
  Identity,
  Passkey,
  Webhook,
  ConfigKey,
  FeatureFlag,
  FeatureFlagOverride,
  UserField,
  DeliveryConfigItem,
  DeliveryFlagItem,
  Delivery,
} from "./client.js";

export { verifyToken, bearerToken, mrAtCookie, expressMiddleware } from "./auth.js";
export type {
  VerifyOptions,
  ExpressMiddlewareOptions,
  AuthenticatedRequest,
} from "./auth.js";

export { verifyWebhook, WebhookError } from "./webhook.js";
export type { VerifyWebhookOptions, WebhookHeaders, WebhookErrorCode } from "./webhook.js";

export { decryptSecret, computePublicJwkFingerprint } from "./secrets.js";
export type { SecretEnvelope, PrivateKeyJwk } from "./secrets.js";