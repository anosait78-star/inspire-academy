// ─── Permission map ──────────────────────────────────────────────────────────
// '*' means unrestricted access (still subject to each role's academy scope,
// enforced separately in controllers via isGlobalScopeRole()).
const PERMISSIONS = {
  SUPER_ADMIN: ['*'],

  ACADEMY_ADMIN: ['*'],

  // Limited admin role (legacy 'admin') — players & subscriptions only.
  ADMIN: [
    'VIEW_PLAYERS', 'CREATE_PLAYER', 'EDIT_PLAYER', 'DELETE_PLAYER',
    'VIEW_SUBSCRIPTIONS', 'CREATE_SUBSCRIPTION', 'RENEW_SUBSCRIPTION',
    'FREEZE_SUBSCRIPTION', 'RESUME_SUBSCRIPTION', 'DELETE_SUBSCRIPTION',
    'VIEW_ACADEMIES', 'VIEW_MATCHES',
  ],

  ACADEMY_SUPERVISOR: [
    'VIEW_PLAYERS', 'CREATE_PLAYER', 'EDIT_PLAYER',
    'VIEW_SUBSCRIPTIONS', 'CREATE_SUBSCRIPTION', 'RENEW_SUBSCRIPTION',
    'FREEZE_SUBSCRIPTION', 'RESUME_SUBSCRIPTION',
    'VIEW_ACADEMIES', 'VIEW_MATCHES',
  ],
};

/**
 * hasPermission(user, permission)
 * Checks whether `user.role` grants `permission` per PERMISSIONS map above.
 * SUPER_ADMIN / ACADEMY_ADMIN hold '*' → always true.
 */
const hasPermission = (user, permission) => {
  if (!user || !user.role) return false;
  const roleKey = user.role.toUpperCase();
  const perms = PERMISSIONS[roleKey];
  if (!perms) return false;
  return perms.includes('*') || perms.includes(permission);
};

/**
 * isGlobalScopeRole(role)
 * Roles allowed to operate across ALL academies (optionally narrowed via an
 * explicit academyId query/body param) rather than being pinned to a single
 * fixed academy. Currently: super_admin and academy_supervisor.
 */
const isGlobalScopeRole = (role) => role === 'super_admin' || role === 'academy_supervisor';

module.exports = { PERMISSIONS, hasPermission, isGlobalScopeRole };
