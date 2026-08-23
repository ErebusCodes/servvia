// @ts-nocheck
/* @ds-bundle: {"format":3,"namespace":"DesignSystem_7f3fe8","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"CardHeader","sourcePath":"components/core/Card.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"StatCard","sourcePath":"components/core/StatCard.jsx"},{"name":"StatusBadge","sourcePath":"components/core/StatusBadge.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"Pagination","sourcePath":"components/data/Pagination.jsx"},{"name":"EmptyState","sourcePath":"components/feedback/EmptyState.jsx"},{"name":"ProgressBar","sourcePath":"components/feedback/ProgressBar.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Sidebar","sourcePath":"components/navigation/Sidebar.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"TopBar","sourcePath":"components/navigation/TopBar.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"e613c85910dc","components/core/Badge.jsx":"2fc52fb58103","components/core/Button.jsx":"9e1b7655dcf0","components/core/Card.jsx":"ebb749d451ca","components/core/IconButton.jsx":"9ae06400e8ad","components/core/StatCard.jsx":"56a4518c6f44","components/core/StatusBadge.jsx":"be8f356ebfbd","components/core/Tag.jsx":"01f6f952ff4e","components/data/DataTable.jsx":"b38be96c6beb","components/data/Pagination.jsx":"1d6f041b77d4","components/feedback/EmptyState.jsx":"5f708e436841","components/feedback/ProgressBar.jsx":"343bad5d4784","components/feedback/Toast.jsx":"f864434c1cf0","components/feedback/Tooltip.jsx":"e9d2956ff5a6","components/forms/Checkbox.jsx":"e94b1971ce96","components/forms/Input.jsx":"6346310d4f37","components/forms/Select.jsx":"702c87acc49d","components/forms/Switch.jsx":"a17b0c9fcb93","components/navigation/Sidebar.jsx":"8157d02c78b4","components/navigation/Tabs.jsx":"a9d489db3325","components/navigation/TopBar.jsx":"311a67b99117","ui_kits/admin/AppShell.jsx":"5355a7612aeb","ui_kits/admin/DashboardScreen.jsx":"7c0d1b47ae13","ui_kits/admin/KitchenScreen.jsx":"bb5e78abd480","ui_kits/admin/OrdersScreen.jsx":"5ac1a50892e9","ui_kits/admin/PaymentsScreen.jsx":"2b1ee83bf880","ui_kits/admin/ReservationsScreen.jsx":"9c82a5f7fb08","ui_kits/admin/data.jsx":"5506efa792dd","ui_kits/admin/icons.jsx":"93dfe55e0edb"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_7f3fe8 = window.DesignSystem_7f3fe8 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Avatar with image, initials fallback, and optional status ring. */
function Avatar({
  src,
  name = '',
  size = 'md',
  status,
  square = false,
  style = {},
  ...rest
}) {
  const dims = {
    xs: 20,
    sm: 28,
    md: 36,
    lg: 44,
    xl: 56
  }[size] || 36;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const fz = dims <= 28 ? 11 : dims <= 36 ? 13 : 16;

  // Deterministic tint from name
  const palette = ['var(--green-600)', 'var(--blue-600)', 'var(--amber-600)', 'var(--violet-600)', 'var(--red-600)'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = h * 31 + name.charCodeAt(i) >>> 0;
  const tint = palette[h % palette.length];
  const statusColors = {
    online: 'var(--color-success)',
    away: 'var(--color-warning)',
    offline: 'var(--color-text-tertiary)',
    busy: 'var(--color-danger)'
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: 'relative',
      display: 'inline-flex',
      flexShrink: 0,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: dims,
      height: dims,
      borderRadius: square ? 'var(--radius-md)' : 'var(--radius-full)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      background: src ? 'var(--color-surface-3)' : tint,
      color: '#fff',
      fontSize: fz,
      fontWeight: 'var(--weight-semibold)',
      fontFamily: 'var(--font-sans)',
      letterSpacing: '-0.01em',
      userSelect: 'none'
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials), status && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: -1,
      bottom: -1,
      width: Math.max(8, dims * 0.28),
      height: Math.max(8, dims * 0.28),
      borderRadius: '50%',
      background: statusColors[status] || statusColors.offline,
      border: '2px solid var(--color-surface)'
    }
  }));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Compact label for counts, states, and categories. `tone` sets the semantic
 * color; `variant` sets soft (subtle fill) vs solid vs outline.
 */
function Badge({
  children,
  tone = 'neutral',
  variant = 'soft',
  dot = false,
  size = 'md',
  style = {},
  ...rest
}) {
  const tones = {
    neutral: {
      fg: 'var(--color-text-secondary)',
      bg: 'var(--color-surface-3)',
      bd: 'var(--color-border)',
      solid: 'var(--gray-600)'
    },
    primary: {
      fg: 'var(--green-700)',
      bg: 'var(--color-primary-subtle)',
      bd: 'var(--color-success-border)',
      solid: 'var(--color-primary)'
    },
    success: {
      fg: 'var(--color-success)',
      bg: 'var(--color-success-bg)',
      bd: 'var(--color-success-border)',
      solid: 'var(--color-success)'
    },
    warning: {
      fg: 'var(--color-warning)',
      bg: 'var(--color-warning-bg)',
      bd: 'var(--color-warning-border)',
      solid: 'var(--color-warning)'
    },
    danger: {
      fg: 'var(--color-danger)',
      bg: 'var(--color-danger-bg)',
      bd: 'var(--color-danger-border)',
      solid: 'var(--color-danger)'
    },
    info: {
      fg: 'var(--color-info)',
      bg: 'var(--color-info-bg)',
      bd: 'var(--color-info-border)',
      solid: 'var(--color-info)'
    },
    accent: {
      fg: 'var(--color-accent)',
      bg: 'var(--color-accent-bg)',
      bd: 'var(--color-accent-border)',
      solid: 'var(--color-accent)'
    }
  };
  const t = tones[tone] || tones.neutral;
  const pad = size === 'sm' ? '1px 6px' : '2px 8px';
  const fz = size === 'sm' ? '11px' : 'var(--text-xs-size)';
  const styleByVariant = {
    soft: {
      background: t.bg,
      color: t.fg,
      border: '1px solid transparent'
    },
    outline: {
      background: 'transparent',
      color: t.fg,
      border: `1px solid ${t.bd}`
    },
    solid: {
      background: t.solid,
      color: '#fff',
      border: '1px solid transparent'
    }
  }[variant];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: pad,
      fontFamily: 'var(--font-sans)',
      fontSize: fz,
      fontWeight: 'var(--weight-medium)',
      lineHeight: '16px',
      borderRadius: 'var(--radius-xs)',
      whiteSpace: 'nowrap',
      ...styleByVariant,
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      flexShrink: 0,
      background: variant === 'solid' ? '#fff' : t.solid
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Verdura primary button. Solid green primary, neutral secondary,
 * low-emphasis ghost, and destructive danger. Three sizes.
 */
function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft = null,
  iconRight = null,
  disabled = false,
  loading = false,
  fullWidth = false,
  type = 'button',
  onClick,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: {
      height: 'var(--control-height-sm)',
      padding: '0 10px',
      font: 'var(--text-xs-size)',
      gap: '6px'
    },
    md: {
      height: 'var(--control-height-md)',
      padding: '0 14px',
      font: 'var(--text-body-size)',
      gap: '8px'
    },
    lg: {
      height: 'var(--control-height-lg)',
      padding: '0 20px',
      font: 'var(--text-body-size)',
      gap: '8px'
    }
  };
  const variants = {
    primary: {
      background: 'var(--color-primary)',
      color: 'var(--color-on-primary)',
      border: '1px solid transparent'
    },
    secondary: {
      background: 'var(--color-surface)',
      color: 'var(--color-text)',
      border: '1px solid var(--color-border-strong)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      border: '1px solid transparent'
    },
    danger: {
      background: 'var(--color-danger)',
      color: '#ffffff',
      border: '1px solid transparent'
    }
  };
  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.primary;
  const isDisabled = disabled || loading;
  const hoverBg = {
    primary: 'var(--color-primary-hover)',
    secondary: 'var(--color-surface-3)',
    ghost: 'var(--color-surface-3)',
    danger: 'var(--red-700)'
  }[variant];
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: isDisabled,
    onClick: onClick,
    onMouseEnter: e => {
      if (!isDisabled) e.currentTarget.style.background = hoverBg;
    },
    onMouseLeave: e => {
      if (!isDisabled) e.currentTarget.style.background = v.background;
    },
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s.gap,
      height: s.height,
      padding: s.padding,
      width: fullWidth ? '100%' : 'auto',
      fontFamily: 'var(--font-sans)',
      fontSize: s.font,
      fontWeight: 'var(--weight-medium)',
      lineHeight: 1,
      letterSpacing: '-0.005em',
      borderRadius: 'var(--radius-sm)',
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      opacity: isDisabled ? 0.5 : 1,
      whiteSpace: 'nowrap',
      transition: 'background var(--duration-fast) var(--ease-in-out), box-shadow var(--duration-fast) var(--ease-in-out)',
      ...v,
      ...style
    }
  }, rest), loading && /*#__PURE__*/React.createElement(Spinner, null), !loading && iconLeft, children, !loading && iconRight);
}
function Spinner() {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: 14,
      height: 14,
      borderRadius: '50%',
      border: '2px solid currentColor',
      borderTopColor: 'transparent',
      display: 'inline-block',
      animation: 'verdura-spin 0.6s linear infinite'
    }
  }, /*#__PURE__*/React.createElement("style", null, `@keyframes verdura-spin{to{transform:rotate(360deg)}}`));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Surface container. The default content block across Verdura. */
function Card({
  children,
  padding = 'md',
  interactive = false,
  style = {},
  ...rest
}) {
  const pad = {
    none: 0,
    sm: 'var(--space-4)',
    md: 'var(--space-6)',
    lg: 'var(--space-8)'
  }[padding] ?? 'var(--space-6)';
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      padding: pad,
      boxShadow: 'var(--shadow-xs)',
      transition: interactive ? 'box-shadow var(--duration-base) var(--ease-in-out), border-color var(--duration-base) var(--ease-in-out)' : 'none',
      cursor: interactive ? 'pointer' : 'default',
      ...style
    },
    onMouseEnter: interactive ? e => {
      e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      e.currentTarget.style.borderColor = 'var(--color-border-strong)';
    } : undefined,
    onMouseLeave: interactive ? e => {
      e.currentTarget.style.boxShadow = 'var(--shadow-xs)';
      e.currentTarget.style.borderColor = 'var(--color-border)';
    } : undefined
  }, rest), children);
}

/** Optional header row for a Card — title left, actions right. */
function CardHeader({
  title,
  subtitle,
  action,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 'var(--space-4)',
      marginBottom: 'var(--space-4)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-h3-size)',
      lineHeight: 'var(--text-h3-lh)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--color-text)',
      letterSpacing: '-0.01em'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-sm-size)',
      color: 'var(--color-text-secondary)',
      marginTop: 2
    }
  }, subtitle)), action && /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0
    }
  }, action));
}
Object.assign(__ds_scope, { Card, CardHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Square/circular icon-only button for toolbars, table rows, and headers.
 * Pairs with Lucide icons. No visible label — pass `aria-label`.
 */
function IconButton({
  children,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  round = false,
  onClick,
  style = {},
  ...rest
}) {
  const dims = {
    sm: 28,
    md: 36,
    lg: 44
  }[size] || 36;
  const variants = {
    ghost: {
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      border: '1px solid transparent'
    },
    outline: {
      background: 'var(--color-surface)',
      color: 'var(--color-text)',
      border: '1px solid var(--color-border-strong)'
    },
    solid: {
      background: 'var(--color-primary)',
      color: 'var(--color-on-primary)',
      border: '1px solid transparent'
    }
  };
  const v = variants[variant] || variants.ghost;
  const hoverBg = variant === 'solid' ? 'var(--color-primary-hover)' : 'var(--color-surface-3)';
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: e => {
      if (!disabled) e.currentTarget.style.background = hoverBg;
    },
    onMouseLeave: e => {
      if (!disabled) e.currentTarget.style.background = v.background;
    },
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: dims,
      height: dims,
      flexShrink: 0,
      borderRadius: round ? 'var(--radius-full)' : 'var(--radius-sm)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'background var(--duration-fast) var(--ease-in-out)',
      ...v,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/StatCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Dashboard metric widget. Strong number hierarchy with an optional trend
 * delta and an icon chip. The core building block of the Verdura dashboard.
 */
function StatCard({
  label,
  value,
  delta = null,
  trend = 'up',
  // 'up' | 'down' | 'flat'
  positiveIsGood = true,
  icon = null,
  hint = null,
  style = {},
  ...rest
}) {
  const good = trend === 'flat' ? null : trend === 'up' === positiveIsGood;
  const trendColor = good === null ? 'var(--color-text-secondary)' : good ? 'var(--color-success)' : 'var(--color-danger)';
  const arrow = trend === 'up' ? 'M3 9.5 6 6.5l2 2 4-4M12 4.5h-3M12 4.5v3' : trend === 'down' ? 'M3 5.5 6 8.5l2-2 4 4M12 9.5h-3M12 9.5v-3' : 'M3 7h10';
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-5)',
      boxShadow: 'var(--shadow-xs)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs-size)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--color-text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-wide)'
    }
  }, label), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 'var(--radius-md)',
      flexShrink: 0,
      background: 'var(--color-primary-subtle)',
      color: 'var(--color-primary)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, icon)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 'var(--space-3)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-metric-size)',
      lineHeight: 'var(--text-metric-lh)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--color-text)',
      letterSpacing: 'var(--tracking-tight)',
      fontFeatureSettings: "'tnum' 1"
    }
  }, value), delta != null && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontSize: 'var(--text-sm-size)',
      fontWeight: 'var(--weight-medium)',
      color: trendColor
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "14",
    viewBox: "0 0 15 14",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: arrow
  })), delta)), hint && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-xs-size)',
      color: 'var(--color-text-tertiary)'
    }
  }, hint));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusBadge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Domain status badge for Verdura's operational state machines. Pass a `status`
 * string from any of the reservation / order / system vocabularies and it maps
 * to the correct tone, dot, and label automatically.
 */
const STATUS_MAP = {
  // Reservation lifecycle
  pending: {
    tone: 'warning',
    label: 'Pending'
  },
  confirmed: {
    tone: 'info',
    label: 'Confirmed'
  },
  seated: {
    tone: 'primary',
    label: 'Seated'
  },
  completed: {
    tone: 'neutral',
    label: 'Completed'
  },
  cancelled: {
    tone: 'danger',
    label: 'Cancelled'
  },
  no_show: {
    tone: 'danger',
    label: 'No Show'
  },
  'no-show': {
    tone: 'danger',
    label: 'No Show'
  },
  // Order lifecycle
  new: {
    tone: 'info',
    label: 'New'
  },
  accepted: {
    tone: 'primary',
    label: 'Accepted'
  },
  preparing: {
    tone: 'warning',
    label: 'Preparing'
  },
  ready: {
    tone: 'success',
    label: 'Ready'
  },
  // System / integration health
  healthy: {
    tone: 'success',
    label: 'Healthy'
  },
  warning: {
    tone: 'warning',
    label: 'Warning'
  },
  offline: {
    tone: 'neutral',
    label: 'Offline'
  },
  syncing: {
    tone: 'accent',
    label: 'Syncing'
  },
  failed: {
    tone: 'danger',
    label: 'Failed'
  }
};
function StatusBadge({
  status,
  variant = 'soft',
  size = 'md',
  pulse,
  label,
  ...rest
}) {
  const key = String(status || '').toLowerCase().replace(/\s+/g, '_');
  const cfg = STATUS_MAP[key] || STATUS_MAP[String(status).toLowerCase()] || {
    tone: 'neutral',
    label: status
  };
  const isLive = pulse ?? (key === 'syncing' || key === 'preparing');
  return /*#__PURE__*/React.createElement(__ds_scope.Badge, _extends({
    tone: cfg.tone,
    variant: variant,
    size: size,
    dot: true
  }, rest), isLive && /*#__PURE__*/React.createElement(PulseStyle, null), /*#__PURE__*/React.createElement("span", {
    style: isLive ? {
      animation: 'verdura-pulse 1.4s ease-in-out infinite'
    } : undefined
  }, label || cfg.label));
}
function PulseStyle() {
  return /*#__PURE__*/React.createElement("style", null, `@keyframes verdura-pulse{0%,100%{opacity:1}50%{opacity:.55}}`);
}
Object.assign(__ds_scope, { StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Removable chip — filter tokens, applied facets, tags. */
function Tag({
  children,
  onRemove,
  color = 'neutral',
  style = {},
  ...rest
}) {
  const colors = {
    neutral: {
      bg: 'var(--color-surface-3)',
      fg: 'var(--color-text)',
      bd: 'var(--color-border)'
    },
    primary: {
      bg: 'var(--color-primary-subtle)',
      fg: 'var(--green-700)',
      bd: 'var(--color-success-border)'
    },
    info: {
      bg: 'var(--color-info-bg)',
      fg: 'var(--color-info)',
      bd: 'var(--color-info-border)'
    }
  };
  const c = colors[color] || colors.neutral;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 24,
      padding: onRemove ? '0 6px 0 10px' : '0 10px',
      background: c.bg,
      color: c.fg,
      border: `1px solid ${c.bd}`,
      borderRadius: 'var(--radius-sm)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-xs-size)',
      fontWeight: 'var(--weight-medium)',
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), children, onRemove && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onRemove,
    "aria-label": "Remove",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 16,
      height: 16,
      padding: 0,
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      borderRadius: 'var(--radius-xs)',
      opacity: 0.6
    },
    onMouseEnter: e => e.currentTarget.style.opacity = '1',
    onMouseLeave: e => e.currentTarget.style.opacity = '0.6'
  }, /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 3l6 6M9 3l-6 6"
  }))));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Verdura's primary data surface. Sticky header, sortable columns, optional
 * row selection, zebra-free hairline rows, and a render-prop per column.
 *
 * columns: [{ key, header, width, align, sortable, render(row, value) }]
 * rows:    array of objects
 */
function DataTable({
  columns = [],
  rows = [],
  rowKey = (r, i) => r.id ?? i,
  selectable = false,
  selected = [],
  onSelectedChange,
  sort = null,
  // { key, dir: 'asc'|'desc' }
  onSortChange,
  onRowClick,
  density = 'comfortable',
  // 'comfortable' | 'compact'
  stickyHeader = true,
  emptyMessage = 'No records found',
  style = {},
  ...rest
}) {
  const rowPad = density === 'compact' ? '8px 14px' : '12px 16px';
  const headPad = density === 'compact' ? '8px 14px' : '10px 16px';
  const allKeys = rows.map(rowKey);
  const allSelected = selectable && rows.length > 0 && allKeys.every(k => selected.includes(k));
  const someSelected = selectable && selected.length > 0 && !allSelected;
  const toggleAll = () => onSelectedChange && onSelectedChange(allSelected ? [] : allKeys);
  const toggleRow = k => onSelectedChange && onSelectedChange(selected.includes(k) ? selected.filter(x => x !== k) : [...selected, k]);
  const handleSort = col => {
    if (!col.sortable || !onSortChange) return;
    const dir = sort && sort.key === col.key && sort.dir === 'asc' ? 'desc' : 'asc';
    onSortChange({
      key: col.key,
      dir
    });
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      width: '100%',
      overflow: 'auto',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--color-surface)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, selectable && /*#__PURE__*/React.createElement("th", {
    style: {
      ...thBase,
      padding: headPad,
      width: 44,
      position: stickyHeader ? 'sticky' : undefined,
      top: 0
    }
  }, /*#__PURE__*/React.createElement(CheckCell, {
    checked: allSelected,
    indeterminate: someSelected,
    onChange: toggleAll
  })), columns.map(col => {
    const isSorted = sort && sort.key === col.key;
    return /*#__PURE__*/React.createElement("th", {
      key: col.key,
      onClick: () => handleSort(col),
      style: {
        ...thBase,
        padding: headPad,
        width: col.width,
        textAlign: col.align || 'left',
        cursor: col.sortable ? 'pointer' : 'default',
        position: stickyHeader ? 'sticky' : undefined,
        top: 0,
        userSelect: 'none',
        whiteSpace: 'nowrap'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start'
      }
    }, col.header, col.sortable && /*#__PURE__*/React.createElement(SortIcon, {
      active: isSorted,
      dir: isSorted ? sort.dir : null
    })));
  }))), /*#__PURE__*/React.createElement("tbody", null, rows.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: columns.length + (selectable ? 1 : 0),
    style: {
      padding: '40px 16px',
      textAlign: 'center',
      color: 'var(--color-text-tertiary)',
      fontSize: 'var(--text-sm-size)'
    }
  }, emptyMessage)), rows.map((row, i) => {
    const k = rowKey(row, i);
    const isSel = selected.includes(k);
    return /*#__PURE__*/React.createElement("tr", {
      key: k,
      onClick: onRowClick ? () => onRowClick(row) : undefined,
      style: {
        borderTop: '1px solid var(--color-border)',
        background: isSel ? 'var(--color-primary-subtle)' : 'transparent',
        cursor: onRowClick ? 'pointer' : 'default',
        transition: 'background var(--duration-fast) var(--ease-in-out)'
      },
      onMouseEnter: e => {
        if (!isSel) e.currentTarget.style.background = 'var(--color-surface-2)';
      },
      onMouseLeave: e => {
        if (!isSel) e.currentTarget.style.background = 'transparent';
      }
    }, selectable && /*#__PURE__*/React.createElement("td", {
      style: {
        ...tdBase,
        padding: rowPad,
        width: 44
      },
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement(CheckCell, {
      checked: isSel,
      onChange: () => toggleRow(k)
    })), columns.map(col => {
      const value = row[col.key];
      return /*#__PURE__*/React.createElement("td", {
        key: col.key,
        style: {
          ...tdBase,
          padding: rowPad,
          textAlign: col.align || 'left',
          width: col.width,
          fontVariantNumeric: col.numeric ? 'tabular-nums' : undefined
        }
      }, col.render ? col.render(row, value) : value);
    }));
  }))));
}
const thBase = {
  background: 'var(--color-surface-2)',
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--text-xs-size)',
  fontWeight: 'var(--weight-semibold)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  borderBottom: '1px solid var(--color-border)',
  zIndex: 1
};
const tdBase = {
  fontSize: 'var(--text-sm-size)',
  color: 'var(--color-text)',
  verticalAlign: 'middle'
};
function SortIcon({
  active,
  dir
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      color: active ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 4.5 6 2.5l2 2",
    style: {
      opacity: dir === 'desc' ? 0.3 : 1
    }
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 7.5 6 9.5l2-2",
    style: {
      opacity: dir === 'asc' ? 0.3 : 1
    }
  }));
}
function CheckCell({
  checked,
  indeterminate,
  onChange
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const on = checked || indeterminate;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement("input", {
    ref: ref,
    type: "checkbox",
    checked: !!checked,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    onClick: onChange,
    style: {
      width: 18,
      height: 18,
      borderRadius: 'var(--radius-xs)',
      cursor: 'pointer',
      background: on ? 'var(--color-primary)' : 'var(--color-surface)',
      border: `1.5px solid ${on ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff'
    }
  }, indeterminate ? /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 6h6"
  })) : checked && /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 6.2l2.3 2.3L9.5 3.8"
  }))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/Pagination.jsx
try { (() => {
/** Pagination footer — range summary + page stepper. Pairs with DataTable. */
function Pagination({
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
  pageSizeOptions = [10, 25, 50, 100],
  onPageSizeChange,
  style = {}
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const go = p => onPageChange && onPageChange(Math.min(pageCount, Math.max(1, p)));
  const chev = d => /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: d
  }));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-4)',
      flexWrap: 'wrap',
      padding: 'var(--space-3) var(--space-1)',
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      fontSize: 'var(--text-sm-size)',
      color: 'var(--color-text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Showing ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--color-text)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, start, "\u2013", end), " of ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--color-text)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, total.toLocaleString())), onPageSizeChange && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-border-strong)'
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("select", {
    value: pageSize,
    onChange: e => onPageSizeChange(Number(e.target.value)),
    style: {
      appearance: 'none',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius-sm)',
      padding: '4px 8px',
      background: 'var(--color-surface)',
      color: 'var(--color-text)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm-size)',
      cursor: 'pointer'
    }
  }, pageSizeOptions.map(n => /*#__PURE__*/React.createElement("option", {
    key: n,
    value: n
  }, n, " / page"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    variant: "outline",
    size: "sm",
    "aria-label": "Previous page",
    disabled: page <= 1,
    onClick: () => go(page - 1)
  }, chev('M15 18l-6-6 6-6')), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm-size)',
      color: 'var(--color-text-secondary)',
      padding: '0 8px',
      fontVariantNumeric: 'tabular-nums'
    }
  }, "Page ", page, " of ", pageCount), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    variant: "outline",
    size: "sm",
    "aria-label": "Next page",
    disabled: page >= pageCount,
    onClick: () => go(page + 1)
  }, chev('M9 18l6-6-6-6'))));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Pagination.jsx", error: String((e && e.message) || e) }); }

// components/feedback/EmptyState.jsx
try { (() => {
/** Empty-state placeholder for tables, panels, and filtered views. */
function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      padding: compact ? 'var(--space-8) var(--space-6)' : 'var(--space-12) var(--space-6)',
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, icon && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 48,
      height: 48,
      borderRadius: 'var(--radius-lg)',
      marginBottom: 'var(--space-4)',
      background: 'var(--color-surface-3)',
      color: 'var(--color-text-tertiary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, icon), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-h3-size)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--color-text)'
    }
  }, title), description && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-sm-size)',
      color: 'var(--color-text-secondary)',
      marginTop: 4,
      maxWidth: 360
    }
  }, description), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-5)'
    }
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ProgressBar.jsx
try { (() => {
/** Linear progress / utilization bar. Use for capacity, throughput, sync. */
function ProgressBar({
  value = 0,
  max = 100,
  tone = 'primary',
  size = 'md',
  label,
  showValue = false,
  style = {}
}) {
  const pct = Math.max(0, Math.min(100, value / max * 100));
  const tones = {
    primary: 'var(--color-primary)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    danger: 'var(--color-danger)',
    info: 'var(--color-info)'
  };
  const h = size === 'sm' ? 4 : size === 'lg' ? 10 : 6;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, (label || showValue) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 6
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm-size)',
      color: 'var(--color-text-secondary)'
    }
  }, label), showValue && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm-size)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--color-text)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, Math.round(pct), "%")), /*#__PURE__*/React.createElement("div", {
    role: "progressbar",
    "aria-valuenow": value,
    "aria-valuemax": max,
    style: {
      height: h,
      background: 'var(--color-surface-3)',
      borderRadius: 'var(--radius-full)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${pct}%`,
      height: '100%',
      background: tones[tone] || tones.primary,
      borderRadius: 'var(--radius-full)',
      transition: 'width var(--duration-slow) var(--ease-out)'
    }
  })));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
/** Inline toast/notification surface. Render inside a fixed stack container. */
function Toast({
  title,
  description,
  tone = 'neutral',
  onClose,
  action,
  style = {}
}) {
  const tones = {
    neutral: {
      fg: 'var(--color-text)',
      accent: 'var(--color-text-secondary)',
      icon: 'info'
    },
    success: {
      fg: 'var(--color-success)',
      accent: 'var(--color-success)',
      icon: 'check'
    },
    warning: {
      fg: 'var(--color-warning)',
      accent: 'var(--color-warning)',
      icon: 'alert'
    },
    danger: {
      fg: 'var(--color-danger)',
      accent: 'var(--color-danger)',
      icon: 'alert'
    },
    info: {
      fg: 'var(--color-info)',
      accent: 'var(--color-info)',
      icon: 'info'
    }
  };
  const t = tones[tone] || tones.neutral;
  const glyphs = {
    check: /*#__PURE__*/React.createElement("path", {
      d: "M20 6 9 17l-5-5"
    }),
    alert: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 9v4M12 17h.01"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
    })),
    info: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 16v-4M12 8h.01"
    }))
  };
  return /*#__PURE__*/React.createElement("div", {
    role: "status",
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      width: 360,
      maxWidth: '100%',
      padding: '14px 14px 14px 16px',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-lg)',
      fontFamily: 'var(--font-sans)',
      borderLeft: `3px solid ${t.accent}`,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: t.accent,
      flexShrink: 0,
      marginTop: 1
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, glyphs[t.icon])), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-sm-size)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--color-text)'
    }
  }, title), description && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-sm-size)',
      color: 'var(--color-text-secondary)',
      marginTop: 2
    }
  }, description), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, action)), onClose && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    "aria-label": "Dismiss",
    style: {
      flexShrink: 0,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--color-text-tertiary)',
      padding: 2,
      borderRadius: 'var(--radius-xs)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
/** Lightweight CSS tooltip. Wraps a trigger; shows `content` on hover/focus. */
function Tooltip({
  content,
  children,
  placement = 'top',
  style = {}
}) {
  const [show, setShow] = React.useState(false);
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: 8
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginTop: 8
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginRight: 8
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginLeft: 8
    }
  }[placement];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false),
    onFocus: () => setShow(true),
    onBlur: () => setShow(false)
  }, children, /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      zIndex: 50,
      ...pos,
      pointerEvents: 'none',
      padding: '6px 9px',
      background: 'var(--gray-900)',
      color: '#fff',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-xs-size)',
      fontWeight: 'var(--weight-medium)',
      lineHeight: 1.4,
      borderRadius: 'var(--radius-sm)',
      whiteSpace: 'nowrap',
      boxShadow: 'var(--shadow-md)',
      opacity: show ? 1 : 0,
      transform: `${pos.transform} translateY(${show ? '0' : placement === 'top' ? '2px' : '-2px'})`,
      transition: 'opacity var(--duration-fast) var(--ease-out)',
      ...style
    }
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Checkbox with label. Supports indeterminate. */
function Checkbox({
  label,
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  id,
  style = {},
  ...rest
}) {
  const ref = React.useRef(null);
  const cbId = id || React.useId();
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const on = checked || indeterminate;
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: cbId,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    ref: ref,
    id: cbId,
    type: "checkbox",
    checked: !!checked,
    disabled: disabled,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 18,
      height: 18,
      borderRadius: 'var(--radius-xs)',
      background: on ? 'var(--color-primary)' : 'var(--color-surface)',
      border: `1.5px solid ${on ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      transition: 'background var(--duration-fast) var(--ease-in-out), border-color var(--duration-fast) var(--ease-in-out)'
    }
  }, indeterminate ? /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 6h6"
  })) : checked && /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 6.2l2.3 2.3L9.5 3.8"
  })))), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-body-size)',
      color: 'var(--color-text)'
    }
  }, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Text input with label, optional leading/trailing icon, hint, and error. */
function Input({
  label,
  hint,
  error,
  leftIcon,
  rightIcon,
  size = 'md',
  disabled = false,
  fullWidth = true,
  id,
  style = {},
  containerStyle = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const inputId = id || React.useId();
  const heights = {
    sm: 'var(--control-height-sm)',
    md: 'var(--control-height-md)',
    lg: 'var(--control-height-lg)'
  };
  const borderColor = error ? 'var(--color-danger)' : focus ? 'var(--color-border-focus)' : 'var(--color-border-strong)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      width: fullWidth ? '100%' : 'auto',
      ...containerStyle
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      fontSize: 'var(--text-sm-size)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--color-text)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: heights[size],
      padding: '0 12px',
      background: disabled ? 'var(--color-surface-2)' : 'var(--color-surface)',
      border: `1px solid ${borderColor}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: focus ? 'var(--shadow-focus)' : 'none',
      transition: 'border-color var(--duration-fast) var(--ease-in-out), box-shadow var(--duration-fast) var(--ease-in-out)',
      cursor: disabled ? 'not-allowed' : 'text',
      opacity: disabled ? 0.6 : 1
    }
  }, leftIcon && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-text-tertiary)',
      display: 'inline-flex',
      flexShrink: 0
    }
  }, leftIcon), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-body-size)',
      color: 'var(--color-text)',
      ...style
    }
  }, rest)), rightIcon && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-text-tertiary)',
      display: 'inline-flex',
      flexShrink: 0
    }
  }, rightIcon)), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs-size)',
      color: error ? 'var(--color-danger)' : 'var(--color-text-secondary)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Native select styled to match Verdura inputs. */
function Select({
  label,
  hint,
  error,
  options = [],
  size = 'md',
  disabled = false,
  fullWidth = true,
  id,
  style = {},
  containerStyle = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const selectId = id || React.useId();
  const heights = {
    sm: 'var(--control-height-sm)',
    md: 'var(--control-height-md)',
    lg: 'var(--control-height-lg)'
  };
  const borderColor = error ? 'var(--color-danger)' : focus ? 'var(--color-border-focus)' : 'var(--color-border-strong)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      width: fullWidth ? '100%' : 'auto',
      ...containerStyle
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: selectId,
    style: {
      fontSize: 'var(--text-sm-size)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--color-text)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: selectId,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      width: '100%',
      height: heights[size],
      padding: '0 34px 0 12px',
      background: disabled ? 'var(--color-surface-2)' : 'var(--color-surface)',
      border: `1px solid ${borderColor}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: focus ? 'var(--shadow-focus)' : 'none',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-body-size)',
      color: 'var(--color-text)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      outline: 'none',
      transition: 'border-color var(--duration-fast) var(--ease-in-out), box-shadow var(--duration-fast) var(--ease-in-out)',
      ...style
    }
  }, rest), options.map(o => {
    const opt = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value
    }, opt.label);
  })), /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--color-text-tertiary)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      position: 'absolute',
      right: 10,
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 9l6 6 6-6"
  }))), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs-size)',
      color: error ? 'var(--color-danger)' : 'var(--color-text-secondary)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Toggle switch for binary settings. */
function Switch({
  checked = false,
  disabled = false,
  onChange,
  label,
  size = 'md',
  id,
  style = {},
  ...rest
}) {
  const swId = id || React.useId();
  const dims = size === 'sm' ? {
    w: 32,
    h: 18,
    k: 14
  } : {
    w: 40,
    h: 22,
    k: 18
  };
  const pad = (dims.h - dims.k) / 2;
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: swId,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("button", _extends({
    id: swId,
    type: "button",
    role: "switch",
    "aria-checked": checked,
    disabled: disabled,
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      width: dims.w,
      height: dims.h,
      flexShrink: 0,
      padding: 0,
      border: 'none',
      borderRadius: 'var(--radius-full)',
      position: 'relative',
      cursor: 'inherit',
      background: checked ? 'var(--color-primary)' : 'var(--color-border-strong)',
      transition: 'background var(--duration-base) var(--ease-in-out)'
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: pad,
      left: checked ? dims.w - dims.k - pad : pad,
      width: dims.k,
      height: dims.k,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: 'var(--shadow-sm)',
      transition: 'left var(--duration-base) var(--ease-out)'
    }
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-body-size)',
      color: 'var(--color-text)'
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Sidebar.jsx
try { (() => {
/**
 * Verdura left navigation. Collapsible to an icon rail, grouped sections,
 * active item highlight, and a brand header. Icons are passed per item.
 *
 * items: [{ key, label, icon, badge?, section? }] OR
 * groups: [{ title, items: [...] }]
 */
function Sidebar({
  groups = null,
  items = [],
  active,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  brand = 'Verdura',
  footer = null,
  style = {}
}) {
  const resolvedGroups = groups || [{
    title: null,
    items
  }];
  const width = collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)';
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      width,
      minWidth: width,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-surface)',
      borderRight: '1px solid var(--color-border)',
      fontFamily: 'var(--font-sans)',
      transition: 'width var(--duration-base) var(--ease-in-out), min-width var(--duration-base) var(--ease-in-out)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 'var(--topnav-height)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: collapsed ? '0 12px' : '0 18px',
      borderBottom: '1px solid var(--color-border)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 28,
      height: 28,
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-primary)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 40 40",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 28.5c-5.1-1.7-9.5-6.8-9.5-14.4a.9.9 0 0 1 .9-.9c3.1 0 6.1.8 8.6 3.1 2.5-2.3 5.5-3.1 8.6-3.1a.9.9 0 0 1 .9.9c0 7.6-4.4 12.7-9.5 14.4Z",
    stroke: "#fff",
    strokeWidth: "1.8",
    strokeLinejoin: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20 17.4V29",
    stroke: "#fff",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }))), !collapsed && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-h3-size)',
      fontWeight: 'var(--weight-semibold)',
      letterSpacing: '-0.02em',
      color: 'var(--color-text)'
    }
  }, brand)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '12px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, resolvedGroups.map((g, gi) => /*#__PURE__*/React.createElement("div", {
    key: gi,
    style: {
      marginBottom: g.title ? 8 : 0
    }
  }, g.title && !collapsed && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 10px 4px',
      fontSize: '11px',
      fontWeight: 'var(--weight-semibold)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-wide)',
      color: 'var(--color-text-tertiary)'
    }
  }, g.title), g.items.map(it => {
    const isActive = it.key === active;
    return /*#__PURE__*/React.createElement("button", {
      key: it.key,
      type: "button",
      title: collapsed ? it.label : undefined,
      onClick: () => onNavigate && onNavigate(it.key),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        width: '100%',
        padding: collapsed ? '9px' : '8px 10px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        textAlign: 'left',
        background: isActive ? 'var(--color-primary-subtle)' : 'transparent',
        color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-body-size)',
        fontWeight: isActive ? 'var(--weight-semibold)' : 'var(--weight-medium)',
        position: 'relative',
        transition: 'background var(--duration-fast) var(--ease-in-out), color var(--duration-fast) var(--ease-in-out)'
      },
      onMouseEnter: e => {
        if (!isActive) {
          e.currentTarget.style.background = 'var(--color-surface-3)';
          e.currentTarget.style.color = 'var(--color-text)';
        }
      },
      onMouseLeave: e => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--color-text-secondary)';
        }
      }
    }, isActive && !collapsed && /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        left: -10,
        top: 7,
        bottom: 7,
        width: 3,
        borderRadius: '0 3px 3px 0',
        background: 'var(--color-primary)'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        flexShrink: 0,
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, it.icon), !collapsed && /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }
    }, it.label), !collapsed && it.badge != null && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '11px',
        fontWeight: 600,
        color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
        background: isActive ? 'var(--color-surface)' : 'var(--color-surface-3)',
        borderRadius: 'var(--radius-full)',
        padding: '1px 7px',
        minWidth: 18,
        textAlign: 'center'
      }
    }, it.badge));
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--color-border)',
      padding: 10,
      flexShrink: 0
    }
  }, footer, onToggleCollapse && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onToggleCollapse,
    "aria-label": "Toggle sidebar",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 11,
      width: '100%',
      justifyContent: collapsed ? 'center' : 'flex-start',
      padding: collapsed ? '9px' : '8px 10px',
      border: 'none',
      background: 'transparent',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      color: 'var(--color-text-tertiary)',
      fontSize: 'var(--text-body-size)',
      fontFamily: 'var(--font-sans)'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--color-surface-3)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      flexShrink: 0,
      transform: collapsed ? 'rotate(180deg)' : 'none',
      transition: 'transform var(--duration-base) var(--ease-in-out)'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M15 18l-6-6 6-6"
  })), !collapsed && /*#__PURE__*/React.createElement("span", null, "Collapse"))));
}
Object.assign(__ds_scope, { Sidebar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Sidebar.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
/** Underline tab bar for in-page view switching. */
function Tabs({
  tabs = [],
  active,
  onChange,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      borderBottom: '1px solid var(--color-border)',
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, tabs.map(t => {
    const key = typeof t === 'string' ? t : t.key;
    const label = typeof t === 'string' ? t : t.label;
    const badge = typeof t === 'string' ? null : t.badge;
    const isActive = key === active;
    return /*#__PURE__*/React.createElement("button", {
      key: key,
      role: "tab",
      "aria-selected": isActive,
      type: "button",
      onClick: () => onChange && onChange(key),
      style: {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '10px 12px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-body-size)',
        fontWeight: isActive ? 'var(--weight-semibold)' : 'var(--weight-medium)',
        color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
        transition: 'color var(--duration-fast) var(--ease-in-out)',
        marginBottom: -1
      },
      onMouseEnter: e => {
        if (!isActive) e.currentTarget.style.color = 'var(--color-text)';
      },
      onMouseLeave: e => {
        if (!isActive) e.currentTarget.style.color = 'var(--color-text-secondary)';
      }
    }, label, badge != null && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        padding: '0 6px',
        borderRadius: 'var(--radius-full)',
        background: isActive ? 'var(--color-primary-subtle)' : 'var(--color-surface-3)',
        color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)'
      }
    }, badge), /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: 0,
        height: 2,
        borderRadius: '2px 2px 0 0',
        background: 'var(--color-primary)',
        opacity: isActive ? 1 : 0,
        transition: 'opacity var(--duration-fast) var(--ease-in-out)'
      }
    }));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/navigation/TopBar.jsx
try { (() => {
/**
 * Fixed top bar — page title/breadcrumb at left, search + actions at right.
 * Sits above content, beside the Sidebar.
 */
function TopBar({
  title,
  breadcrumb = null,
  search = null,
  actions = null,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 'var(--topnav-height)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-4)',
      padding: '0 var(--space-6)',
      flexShrink: 0,
      background: 'var(--color-surface)',
      borderBottom: '1px solid var(--color-border)',
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 1
    }
  }, breadcrumb && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-xs-size)',
      color: 'var(--color-text-tertiary)',
      whiteSpace: 'nowrap'
    }
  }, breadcrumb), title && /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 'var(--text-h2-size)',
      lineHeight: 'var(--text-h2-lh)',
      fontWeight: 'var(--weight-semibold)',
      letterSpacing: '-0.02em',
      color: 'var(--color-text)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, title)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      flexShrink: 0
    }
  }, search, actions));
}
Object.assign(__ds_scope, { TopBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/TopBar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/AppShell.jsx
try { (() => {
/* AppShell — the Verdura admin shell: sidebar + top bar + routed content. */
function AppShell() {
  const {
    Sidebar,
    TopBar,
    Input,
    IconButton,
    Avatar,
    Button,
    EmptyState,
    Badge
  } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const [active, setActive] = React.useState('dashboard');
  const [collapsed, setCollapsed] = React.useState(false);
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);
  const groups = [{
    title: 'Operations',
    items: [{
      key: 'dashboard',
      label: 'Dashboard',
      icon: /*#__PURE__*/React.createElement(I.dashboard, null)
    }, {
      key: 'reservations',
      label: 'Reservations',
      icon: /*#__PURE__*/React.createElement(I.calendar, null),
      badge: '24'
    }, {
      key: 'orders',
      label: 'Orders',
      icon: /*#__PURE__*/React.createElement(I.orders, null),
      badge: '11'
    }, {
      key: 'kitchen',
      label: 'Kitchen Operations',
      icon: /*#__PURE__*/React.createElement(I.kitchen, null)
    }, {
      key: 'menu',
      label: 'Menu Management',
      icon: /*#__PURE__*/React.createElement(I.menu, null)
    }]
  }, {
    title: 'Business',
    items: [{
      key: 'payments',
      label: 'Payments',
      icon: /*#__PURE__*/React.createElement(I.payments, null)
    }, {
      key: 'staff',
      label: 'Staff',
      icon: /*#__PURE__*/React.createElement(I.staff, null)
    }, {
      key: 'venues',
      label: 'Venues',
      icon: /*#__PURE__*/React.createElement(I.venues, null)
    }]
  }, {
    title: 'System',
    items: [{
      key: 'printers',
      label: 'Printers',
      icon: /*#__PURE__*/React.createElement(I.printer, null)
    }, {
      key: 'pos',
      label: 'POS Sync',
      icon: /*#__PURE__*/React.createElement(I.sync, null)
    }, {
      key: 'audit',
      label: 'Audit Logs',
      icon: /*#__PURE__*/React.createElement(I.audit, null)
    }, {
      key: 'reports',
      label: 'Reports',
      icon: /*#__PURE__*/React.createElement(I.reports, null)
    }, {
      key: 'settings',
      label: 'Settings',
      icon: /*#__PURE__*/React.createElement(I.settings, null)
    }]
  }];
  const meta = {
    dashboard: {
      title: 'Dashboard',
      crumb: 'Operations',
      sub: "Thursday, June 19 · Verdura — Downtown"
    },
    reservations: {
      title: 'Reservations',
      crumb: 'Operations / Reservations'
    },
    orders: {
      title: 'Orders',
      crumb: 'Operations / Orders'
    },
    kitchen: {
      title: 'Kitchen Operations',
      crumb: 'Operations / Kitchen'
    },
    payments: {
      title: 'Payments',
      crumb: 'Business / Payments'
    }
  };
  const m = meta[active] || {
    title: groups.flatMap(g => g.items).find(i => i.key === active)?.label,
    crumb: ''
  };
  const screens = {
    dashboard: window.DashboardScreen,
    reservations: window.ReservationsScreen,
    orders: window.OrdersScreen,
    kitchen: window.KitchenScreen,
    payments: window.PaymentsScreen
  };
  const Screen = screens[active];
  const footer = /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: collapsed ? '6px 0' : '6px 8px',
      justifyContent: collapsed ? 'center' : 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: "Mohammed Chowdhury",
    size: "sm",
    status: "online"
  }), !collapsed && /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--color-text)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, "Mohammed Chowdhury"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-tertiary)'
    }
  }, "Executive Director")));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100vh',
      width: '100%',
      overflow: 'hidden',
      background: 'var(--color-bg)'
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    groups: groups,
    active: active,
    onNavigate: setActive,
    collapsed: collapsed,
    onToggleCollapse: () => setCollapsed(!collapsed),
    footer: footer
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(TopBar, {
    title: m.title,
    breadcrumb: m.crumb,
    search: /*#__PURE__*/React.createElement(Input, {
      fullWidth: false,
      placeholder: "Search venues, guests, orders\u2026",
      leftIcon: /*#__PURE__*/React.createElement(I.search, {
        size: 15
      }),
      containerStyle: {
        width: 280
      }
    }),
    actions: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      variant: "ghost",
      "aria-label": "Toggle theme",
      onClick: () => setDark(!dark)
    }, dark ? /*#__PURE__*/React.createElement("svg", {
      width: "18",
      height: "18",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 2v2M12 20v2M5 5l1.5 1.5M17.5 17.5 19 19M2 12h2M20 12h2M5 19l1.5-1.5M17.5 6.5 19 5"
    })) : /*#__PURE__*/React.createElement("svg", {
      width: "18",
      height: "18",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
    }))), /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'relative',
        display: 'inline-flex'
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      variant: "ghost",
      "aria-label": "Notifications"
    }, /*#__PURE__*/React.createElement(I.bell, null)), /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        top: 6,
        right: 7,
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: 'var(--color-danger)',
        border: '2px solid var(--color-surface)'
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 1,
        height: 22,
        background: 'var(--color-border)',
        margin: '0 2px'
      }
    }), /*#__PURE__*/React.createElement(Avatar, {
      name: "Mohammed Chowdhury",
      size: "md",
      status: "online"
    }))
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      overflow: 'auto',
      padding: 24
    }
  }, Screen ? /*#__PURE__*/React.createElement(Screen, null) : /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)'
    }
  }, /*#__PURE__*/React.createElement(EmptyState, {
    icon: I[active] ? React.createElement(I[active], {
      size: 22
    }) : /*#__PURE__*/React.createElement(I.dashboard, {
      size: 22
    }),
    title: `${m.title} module`,
    description: "This surface is part of the Verdura platform. Dashboard, Reservations, Orders, Kitchen Operations, and Payments are wired as interactive demos in this kit.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: () => setActive('dashboard'),
      iconLeft: /*#__PURE__*/React.createElement(I.arrowRight, {
        size: 15
      })
    }, "Back to dashboard")
  })))));
}
window.AppShell = AppShell;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/DashboardScreen.jsx
try { (() => {
/* Dashboard — operational control center overview. */
function DashboardScreen() {
  const {
    StatCard,
    Card,
    CardHeader,
    StatusBadge,
    ProgressBar,
    Button,
    Avatar
  } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const D = window.VData;
  const actTone = {
    primary: 'var(--color-primary)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    danger: 'var(--color-danger)',
    info: 'var(--color-info)',
    neutral: 'var(--color-text-secondary)'
  };
  const actBg = {
    primary: 'var(--color-primary-subtle)',
    success: 'var(--color-success-bg)',
    warning: 'var(--color-warning-bg)',
    danger: 'var(--color-danger-bg)',
    info: 'var(--color-info-bg)',
    neutral: 'var(--color-surface-3)'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Today's Revenue",
    value: "$18,240",
    delta: "+12.4%",
    trend: "up",
    icon: /*#__PURE__*/React.createElement(I.dollar, null),
    hint: "vs. $16,220 yesterday"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Active Reservations",
    value: "84",
    delta: "+6",
    trend: "up",
    icon: /*#__PURE__*/React.createElement(I.calendar, null),
    hint: "24 still upcoming tonight"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Open Orders",
    value: "11",
    delta: "3 ready",
    trend: "flat",
    icon: /*#__PURE__*/React.createElement(I.orders, null),
    hint: "Avg ticket $128.40"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Avg Prep Time",
    value: "14:32",
    delta: "+1:10",
    trend: "up",
    positiveIsGood: false,
    icon: /*#__PURE__*/React.createElement(I.clock, null),
    hint: "Kitchen queue running warm"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.6fr 1fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 20px 4px'
    }
  }, /*#__PURE__*/React.createElement(CardHeader, {
    title: "Kitchen queue status",
    subtitle: "Live station load across the line",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      iconRight: /*#__PURE__*/React.createElement(I.arrowRight, {
        size: 15
      })
    }, "Open KDS")
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '4px 20px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, D.kitchenStations.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.name,
    style: {
      display: 'grid',
      gridTemplateColumns: '120px 1fr 64px',
      gap: 14,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-text-tertiary)'
    }
  }, /*#__PURE__*/React.createElement(I.flame, {
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--color-text)'
    }
  }, s.name)), /*#__PURE__*/React.createElement(ProgressBar, {
    value: s.load,
    tone: s.load > 75 ? 'warning' : 'primary'
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--color-text-secondary)',
      textAlign: 'right',
      fontVariantNumeric: 'tabular-nums'
    }
  }, s.active, " \xB7 ", s.avg))))), /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 20px 14px'
    }
  }, /*#__PURE__*/React.createElement(CardHeader, {
    title: "Upcoming reservations",
    subtitle: "Next seatings tonight",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      iconRight: /*#__PURE__*/React.createElement(I.arrowRight, {
        size: 15
      })
    }, "View all")
  })), /*#__PURE__*/React.createElement("div", null, D.reservations.filter(r => ['confirmed', 'pending', 'seated'].includes(r.status)).slice(0, 4).map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: r.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 20px',
      borderTop: '1px solid var(--color-border)'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: r.guest,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--color-text)'
    }
  }, r.guest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--color-text-secondary)'
    }
  }, "Party of ", r.party, " \xB7 Table ", r.table)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--color-text)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, r.time), /*#__PURE__*/React.createElement(StatusBadge, {
    status: r.status
  })))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 20px 14px'
    }
  }, /*#__PURE__*/React.createElement(CardHeader, {
    title: "System status",
    subtitle: "Integrations & devices"
  })), /*#__PURE__*/React.createElement("div", null, D.systems.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.name,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '11px 20px',
      borderTop: '1px solid var(--color-border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--color-text)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, s.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-tertiary)'
    }
  }, s.detail)), /*#__PURE__*/React.createElement(StatusBadge, {
    status: s.status
  }))))), /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 20px 14px'
    }
  }, /*#__PURE__*/React.createElement(CardHeader, {
    title: "Recent activity"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 20px 8px'
    }
  }, D.activity.map((a, i) => {
    const Glyph = I[a.icon] || I.check;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'flex',
        gap: 12,
        padding: '10px 0',
        borderTop: i === 0 ? 'none' : '1px solid var(--color-border)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 30,
        height: 30,
        flexShrink: 0,
        borderRadius: 'var(--radius-md)',
        background: actBg[a.tone],
        color: actTone[a.tone],
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement(Glyph, {
      size: 15
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: 'var(--color-text)',
        lineHeight: 1.4
      }
    }, /*#__PURE__*/React.createElement("strong", {
      style: {
        fontWeight: 600
      }
    }, a.who), " ", a.what), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--color-text-tertiary)',
        marginTop: 1
      }
    }, a.when)));
  }))))));
}
window.DashboardScreen = DashboardScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/DashboardScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/KitchenScreen.jsx
try { (() => {
/* Kitchen Operations — KDS monitoring, station load & throughput. */
function KitchenScreen() {
  const {
    StatCard,
    Card,
    CardHeader,
    ProgressBar,
    Badge,
    Button,
    StatusBadge
  } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const D = window.VData;
  const tickets = [{
    id: 'ORD-4821',
    table: 'T12',
    station: 'Grill',
    items: ['2× Ribeye', '1× Branzino', '2× Frites'],
    elapsed: '2:10',
    state: 'preparing'
  }, {
    id: 'ORD-4818',
    table: 'T18',
    station: 'Grill',
    items: ['3× Burger', '1× Salmon', '4× Wings'],
    elapsed: '9:42',
    state: 'preparing'
  }, {
    id: 'ORD-4819',
    table: 'TableStation',
    code: 'kiosk-table',
    station: 'Sauté',
    items: ['1× Risotto', '2× Pasta'],
    elapsed: '6:05',
    state: 'preparing'
  }, {
    id: 'ORD-4817',
    table: 'Online',
    station: 'Cold',
    items: ['2× Caesar', '1× Burrata'],
    elapsed: '11:20',
    state: 'ready'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Tickets in Queue",
    value: "11",
    delta: "+3",
    trend: "up",
    positiveIsGood: false,
    icon: /*#__PURE__*/React.createElement(I.utensils, null),
    hint: "Across 4 stations"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Avg Prep Time",
    value: "14:32",
    delta: "+1:10",
    trend: "up",
    positiveIsGood: false,
    icon: /*#__PURE__*/React.createElement(I.clock, null),
    hint: "Target 12:00"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Throughput \xB7 hr",
    value: "38",
    delta: "+5",
    trend: "up",
    icon: /*#__PURE__*/React.createElement(I.trend, null),
    hint: "Tickets completed"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "On-Time Rate",
    value: "91%",
    delta: "\u22124%",
    trend: "down",
    positiveIsGood: false,
    icon: /*#__PURE__*/React.createElement(I.check, null),
    hint: "Below 95% target"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1.4fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(CardHeader, {
    title: "Station load",
    subtitle: "Active tickets & average time",
    action: /*#__PURE__*/React.createElement(StatusBadge, {
      status: "healthy",
      label: "4 online"
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 18
    }
  }, D.kitchenStations.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.name
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-text-tertiary)'
    }
  }, /*#__PURE__*/React.createElement(I.flame, {
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--color-text)'
    }
  }, s.name), /*#__PURE__*/React.createElement(Badge, {
    tone: s.load > 75 ? 'warning' : 'neutral',
    size: "sm"
  }, s.active, " active")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--color-text-secondary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, s.avg)), /*#__PURE__*/React.createElement(ProgressBar, {
    value: s.load,
    tone: s.load > 75 ? 'warning' : 'primary'
  }))))), /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 20px 14px'
    }
  }, /*#__PURE__*/React.createElement(CardHeader, {
    title: "Active tickets",
    subtitle: "Live kitchen display feed",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      iconRight: /*#__PURE__*/React.createElement(I.arrowRight, {
        size: 15
      })
    }, "Full KDS")
  })), /*#__PURE__*/React.createElement("div", null, tickets.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.id,
    style: {
      display: 'flex',
      gap: 14,
      padding: '14px 20px',
      borderTop: '1px solid var(--color-border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      width: 70,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      fontWeight: 700,
      color: 'var(--color-text)'
    }
  }, t.table), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontSize: 12,
      fontWeight: 600,
      fontVariantNumeric: 'tabular-nums',
      color: parseInt(t.elapsed) > 8 ? 'var(--color-danger)' : 'var(--color-warning)'
    }
  }, /*#__PURE__*/React.createElement(I.clock, {
    size: 12
  }), t.elapsed)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--color-text-secondary)'
    }
  }, t.id), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral",
    size: "sm"
  }, t.station), /*#__PURE__*/React.createElement(StatusBadge, {
    status: t.state,
    size: "sm"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px 10px'
    }
  }, t.items.map((it, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      fontSize: 13,
      color: 'var(--color-text)'
    }
  }, it)))), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    style: {
      alignSelf: 'center'
    }
  }, "Bump")))))));
}
window.KitchenScreen = KitchenScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/KitchenScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/OrdersScreen.jsx
try { (() => {
/* Orders — live order feed as a routing board grouped by status. */
function OrdersScreen() {
  const {
    Card,
    StatusBadge,
    Button,
    Badge,
    Tabs,
    Input
  } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const D = window.VData;
  const [tab, setTab] = React.useState('board');
  const lanes = [{
    key: 'new',
    title: 'New',
    tone: 'info'
  }, {
    key: 'accepted',
    title: 'Accepted',
    tone: 'primary'
  }, {
    key: 'preparing',
    title: 'Preparing',
    tone: 'warning'
  }, {
    key: 'ready',
    title: 'Ready',
    tone: 'success'
  }];
  const chanColor = {
    'Dine-in': 'neutral',
    'Kiosk': 'info',
    'Delivery': 'accent',
    'Online': 'accent'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    tabs: [{
      key: 'board',
      label: 'Live board'
    }, {
      key: 'feed',
      label: 'Feed',
      badge: '11'
    }],
    active: tab,
    onChange: setTab
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Input, {
    fullWidth: false,
    placeholder: "Find order\u2026",
    leftIcon: /*#__PURE__*/React.createElement(I.search, {
      size: 15
    }),
    containerStyle: {
      width: 200
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "md",
    iconLeft: /*#__PURE__*/React.createElement(I.printer, {
      size: 15
    })
  }, "Printer routing"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "md",
    iconLeft: /*#__PURE__*/React.createElement(I.plus, {
      size: 15
    })
  }, "New order")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 14,
      alignItems: 'start'
    }
  }, lanes.map(lane => {
    const items = D.orders.filter(o => o.status === lane.key);
    return /*#__PURE__*/React.createElement("div", {
      key: lane.key,
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 4px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: `var(--color-${lane.tone === 'primary' ? 'primary' : lane.tone})`
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--color-text)'
      }
    }, lane.title), /*#__PURE__*/React.createElement(Badge, {
      tone: "neutral",
      size: "sm"
    }, items.length)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }
    }, items.map(o => /*#__PURE__*/React.createElement(Card, {
      key: o.id,
      padding: "none",
      interactive: true,
      style: {
        borderRadius: 'var(--radius-md)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--color-text)'
      }
    }, o.id), /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        color: o.elapsed.includes('2') && o.status === 'preparing' ? 'var(--color-warning)' : 'var(--color-text-tertiary)'
      }
    }, /*#__PURE__*/React.createElement(I.clock, {
      size: 12
    }), o.elapsed)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 15,
        fontWeight: 700,
        color: 'var(--color-text)'
      }
    }, o.table), /*#__PURE__*/React.createElement(Badge, {
      tone: chanColor[o.channel] || 'neutral',
      size: "sm"
    }, o.channel)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 10,
        borderTop: '1px solid var(--color-border)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: 'var(--color-text-secondary)'
      }
    }, o.items, " items"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--color-text)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, "$", o.total.toFixed(2)))))), items.length === 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '20px 0',
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--color-text-tertiary)',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius-md)'
      }
    }, "Empty")));
  })));
}
window.OrdersScreen = OrdersScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/OrdersScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/PaymentsScreen.jsx
try { (() => {
/* Payments — revenue analytics + transactions ledger. */
function PaymentsScreen() {
  const {
    StatCard,
    Card,
    CardHeader,
    DataTable,
    Pagination,
    StatusBadge,
    Badge,
    Button,
    Input,
    Select
  } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const D = window.VData;
  const [sort, setSort] = React.useState({
    key: 'time',
    dir: 'desc'
  });
  const trend = [{
    d: 'Mon',
    v: 12.4
  }, {
    d: 'Tue',
    v: 14.1
  }, {
    d: 'Wed',
    v: 11.8
  }, {
    d: 'Thu',
    v: 16.2
  }, {
    d: 'Fri',
    v: 22.6
  }, {
    d: 'Sat',
    v: 24.9
  }, {
    d: 'Sun',
    v: 18.2
  }];
  const maxV = Math.max(...trend.map(t => t.v));
  const typeTone = {
    Sale: 'neutral',
    Deposit: 'info',
    Refund: 'warning'
  };
  const columns = [{
    key: 'id',
    header: 'Transaction',
    width: 130,
    render: r => /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--color-text-secondary)'
      }
    }, r.id)
  }, {
    key: 'guest',
    header: 'Guest',
    sortable: true,
    render: r => /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        color: 'var(--color-text)'
      }
    }, r.guest)
  }, {
    key: 'method',
    header: 'Method',
    render: r => /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--color-text-secondary)'
      }
    }, r.method)
  }, {
    key: 'type',
    header: 'Type',
    width: 100,
    render: r => /*#__PURE__*/React.createElement(Badge, {
      tone: typeTone[r.type],
      size: "sm"
    }, r.type)
  }, {
    key: 'amount',
    header: 'Amount',
    width: 120,
    align: 'right',
    numeric: true,
    sortable: true,
    render: r => /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        color: r.type === 'Refund' ? 'var(--color-danger)' : 'var(--color-text)'
      }
    }, r.type === 'Refund' ? '−' : '', "$", r.amount.toFixed(2))
  }, {
    key: 'time',
    header: 'Time',
    width: 92,
    align: 'right',
    numeric: true,
    sortable: true,
    render: r => /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--color-text-secondary)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, r.time)
  }, {
    key: 'status',
    header: 'Status',
    width: 120,
    render: r => /*#__PURE__*/React.createElement(StatusBadge, {
      status: r.status === 'completed' ? 'healthy' : 'failed',
      label: r.status === 'completed' ? 'Completed' : 'Failed'
    })
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Revenue \xB7 7 days",
    value: "$120,240",
    delta: "+8.2%",
    trend: "up",
    icon: /*#__PURE__*/React.createElement(I.dollar, null),
    hint: "Net of refunds"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Transactions",
    value: "1,284",
    delta: "+142",
    trend: "up",
    icon: /*#__PURE__*/React.createElement(I.receipt, null),
    hint: "Avg $93.64"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Refunds",
    value: "$1,840",
    delta: "14 issued",
    trend: "flat",
    positiveIsGood: false,
    icon: /*#__PURE__*/React.createElement(I.sync, null),
    hint: "1.5% of revenue"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Deposits Held",
    value: "$3,420",
    delta: "38 active",
    trend: "up",
    icon: /*#__PURE__*/React.createElement(I.check, null),
    hint: "Across upcoming events"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.5fr 1fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(CardHeader, {
    title: "Revenue trend",
    subtitle: "Daily net revenue \xB7 this week",
    action: /*#__PURE__*/React.createElement(Select, {
      fullWidth: false,
      options: ['This week', 'Last week', '30 days'],
      containerStyle: {
        width: 120
      },
      size: "sm"
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 14,
      height: 180,
      padding: '8px 0 0'
    }
  }, trend.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.d,
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      height: '100%',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--color-text-secondary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, "$", t.v, "k"), /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: 38,
      height: `${t.v / maxV * 100}%`,
      background: t.v === maxV ? 'var(--color-primary)' : 'var(--color-primary-subtle)',
      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
      border: t.v === maxV ? 'none' : '1px solid var(--color-success-border)',
      borderBottom: 'none',
      transition: 'height var(--duration-slow) var(--ease-out)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-tertiary)'
    }
  }, t.d))))), /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 20px 14px'
    }
  }, /*#__PURE__*/React.createElement(CardHeader, {
    title: "Payment methods",
    subtitle: "Share of volume"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 20px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, [{
    m: 'Credit / Debit',
    p: 68,
    c: 'var(--color-primary)'
  }, {
    m: 'Apple / Google Pay',
    p: 18,
    c: 'var(--color-info)'
  }, {
    m: 'Cash',
    p: 9,
    c: 'var(--color-warning)'
  }, {
    m: 'Gift card',
    p: 5,
    c: 'var(--color-accent)'
  }].map(x => /*#__PURE__*/React.createElement("div", {
    key: x.m,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-text)'
    }
  }, x.m), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: 'var(--color-text)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, x.p, "%")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 6,
      background: 'var(--color-surface-3)',
      borderRadius: 'var(--radius-full)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${x.p}%`,
      height: '100%',
      background: x.c,
      borderRadius: 'var(--radius-full)'
    }
  }))))))), /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '16px 20px'
    }
  }, /*#__PURE__*/React.createElement(CardHeader, {
    title: "Transactions",
    subtitle: "Most recent first",
    style: {
      marginBottom: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Input, {
    fullWidth: false,
    placeholder: "Search\u2026",
    leftIcon: /*#__PURE__*/React.createElement(I.search, {
      size: 15
    }),
    containerStyle: {
      width: 200
    },
    size: "sm"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(I.download, {
      size: 15
    })
  }, "Export"))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--color-border)'
    }
  }, /*#__PURE__*/React.createElement(DataTable, {
    columns: columns,
    rows: [...D.transactions].sort((a, b) => sort.dir === 'asc' ? a[sort.key] > b[sort.key] ? 1 : -1 : a[sort.key] < b[sort.key] ? 1 : -1),
    sort: sort,
    onSortChange: setSort,
    style: {
      border: 'none',
      borderRadius: 0
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '4px 16px'
    }
  }, /*#__PURE__*/React.createElement(Pagination, {
    page: 1,
    pageSize: 10,
    total: 1284,
    onPageChange: () => {}
  }))));
}
window.PaymentsScreen = PaymentsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/PaymentsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/ReservationsScreen.jsx
try { (() => {
/* Reservations — list view with search, filters, selection & pagination. */
function ReservationsScreen() {
  const {
    DataTable,
    Pagination,
    StatusBadge,
    Avatar,
    Button,
    Input,
    Select,
    Tag,
    Tabs,
    Badge
  } = window.DesignSystem_7f3fe8;
  const I = window.Icon;
  const D = window.VData;
  const [tab, setTab] = React.useState('list');
  const [sel, setSel] = React.useState([]);
  const [sort, setSort] = React.useState({
    key: 'time',
    dir: 'asc'
  });
  const [q, setQ] = React.useState('');
  let rows = D.reservations.filter(r => r.guest.toLowerCase().includes(q.toLowerCase()) || r.id.toLowerCase().includes(q.toLowerCase()));
  rows = [...rows].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return (a[sort.key] > b[sort.key] ? 1 : -1) * dir;
  });
  const columns = [{
    key: 'id',
    header: 'Ref',
    width: 92,
    sortable: true,
    render: r => /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--color-text-secondary)'
      }
    }, r.id)
  }, {
    key: 'guest',
    header: 'Guest',
    sortable: true,
    render: r => /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      name: r.guest,
      size: "sm"
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        color: 'var(--color-text)'
      }
    }, r.guest), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--color-text-tertiary)'
      }
    }, r.phone)), r.tag && /*#__PURE__*/React.createElement(Tag, {
      color: r.tag === 'VIP' ? 'primary' : 'neutral',
      style: {
        marginLeft: 2
      }
    }, r.tag))
  }, {
    key: 'time',
    header: 'Time',
    width: 92,
    sortable: true,
    numeric: true,
    render: r => /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums'
      }
    }, r.time)
  }, {
    key: 'party',
    header: 'Party',
    width: 80,
    align: 'right',
    numeric: true,
    sortable: true
  }, {
    key: 'table',
    header: 'Table',
    width: 80,
    align: 'center',
    render: r => r.table === '—' ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--color-text-tertiary)'
      }
    }, "\u2014") : /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600
      }
    }, r.table)
  }, {
    key: 'status',
    header: 'Status',
    width: 130,
    render: r => /*#__PURE__*/React.createElement(StatusBadge, {
      status: r.status
    })
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    tabs: [{
      key: 'calendar',
      label: 'Calendar'
    }, {
      key: 'timeline',
      label: 'Timeline'
    }, {
      key: 'list',
      label: 'List',
      badge: '428'
    }],
    active: tab,
    onChange: setTab
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    fullWidth: false,
    placeholder: "Search guest or ref\u2026",
    value: q,
    onChange: e => setQ(e.target.value),
    leftIcon: /*#__PURE__*/React.createElement(I.search, {
      size: 15
    }),
    containerStyle: {
      width: 260
    }
  }), /*#__PURE__*/React.createElement(Select, {
    fullWidth: false,
    options: ['All statuses', 'Pending', 'Confirmed', 'Seated', 'Completed'],
    containerStyle: {
      width: 150
    }
  }), /*#__PURE__*/React.createElement(Select, {
    fullWidth: false,
    options: ['Tonight', 'Today', 'This week'],
    containerStyle: {
      width: 130
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "md",
    iconLeft: /*#__PURE__*/React.createElement(I.filter, {
      size: 15
    })
  }, "More filters"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "md",
    iconLeft: /*#__PURE__*/React.createElement(I.download, {
      size: 15
    })
  }, "Export"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "md",
    iconLeft: /*#__PURE__*/React.createElement(I.plus, {
      size: 15
    })
  }, "New reservation")), sel.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 16px',
      background: 'var(--color-primary-subtle)',
      border: '1px solid var(--color-success-border)',
      borderRadius: 'var(--radius-md)'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "primary",
    variant: "solid"
  }, sel.length), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--color-text)',
      fontWeight: 500
    }
  }, "selected"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm"
  }, "Confirm"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm"
  }, "Reassign table"), /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    size: "sm"
  }, "Cancel")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(DataTable, {
    columns: columns,
    rows: rows,
    selectable: true,
    selected: sel,
    onSelectedChange: setSel,
    sort: sort,
    onSortChange: setSort,
    onRowClick: () => {}
  }), /*#__PURE__*/React.createElement(Pagination, {
    page: 1,
    pageSize: 10,
    total: 428,
    onPageChange: () => {},
    onPageSizeChange: () => {}
  })));
}
window.ReservationsScreen = ReservationsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/ReservationsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/data.jsx
try { (() => {
/* Mock operational data for the Verdura admin UI kit. */
window.VData = {
  reservations: [{
    id: 'R-2041',
    guest: 'Marcus Okonjo',
    time: '6:00 PM',
    party: 4,
    table: 'T12',
    phone: '(415) 555-0142',
    status: 'seated',
    tag: 'VIP'
  }, {
    id: 'R-2042',
    guest: 'Lena Park',
    time: '6:15 PM',
    party: 2,
    table: 'T04',
    phone: '(415) 555-0188',
    status: 'confirmed',
    tag: null
  }, {
    id: 'R-2043',
    guest: 'Diego Alvarez',
    time: '6:30 PM',
    party: 6,
    table: 'T18',
    phone: '(415) 555-0119',
    status: 'confirmed',
    tag: 'Birthday'
  }, {
    id: 'R-2044',
    guest: 'Priya Nair',
    time: '6:45 PM',
    party: 3,
    table: '—',
    phone: '(415) 555-0173',
    status: 'pending',
    tag: null
  }, {
    id: 'R-2045',
    guest: 'Tom Becker',
    time: '7:00 PM',
    party: 5,
    table: 'T08',
    phone: '(415) 555-0150',
    status: 'confirmed',
    tag: null
  }, {
    id: 'R-2046',
    guest: 'Aisha Rahman',
    time: '7:15 PM',
    party: 2,
    table: 'T02',
    phone: '(415) 555-0161',
    status: 'seated',
    tag: 'Allergy'
  }, {
    id: 'R-2047',
    guest: 'Greg Myers',
    time: '7:30 PM',
    party: 8,
    table: 'T17',
    phone: '(415) 555-0134',
    status: 'confirmed',
    tag: 'Large party'
  }, {
    id: 'R-2048',
    guest: 'Sofia Russo',
    time: '7:30 PM',
    party: 2,
    table: '—',
    phone: '(415) 555-0177',
    status: 'no_show',
    tag: null
  }, {
    id: 'R-2049',
    guest: 'Kenji Watanabe',
    time: '7:45 PM',
    party: 4,
    table: 'T14',
    phone: '(415) 555-0102',
    status: 'completed',
    tag: null
  }, {
    id: 'R-2050',
    guest: 'Nora Hassan',
    time: '8:00 PM',
    party: 3,
    table: 'T06',
    phone: '(415) 555-0190',
    status: 'cancelled',
    tag: null
  }],
  orders: [{
    id: 'ORD-4821',
    table: 'T12',
    items: 5,
    total: 142.50,
    channel: 'Dine-in',
    elapsed: '2m',
    status: 'new'
  }, {
    id: 'ORD-4820',
    table: 'T04',
    items: 2,
    total: 58.00,
    channel: 'Dine-in',
    elapsed: '4m',
    status: 'accepted'
  }, {
    id: 'ORD-4819',
    table: 'TableStation',
    code: 'kiosk-table',
    items: 3,
    total: 31.25,
    channel: 'Kiosk',
    elapsed: '6m',
    status: 'preparing'
  }, {
    id: 'ORD-4818',
    table: 'T18',
    items: 8,
    total: 268.00,
    channel: 'Dine-in',
    elapsed: '9m',
    status: 'preparing'
  }, {
    id: 'ORD-4817',
    table: 'Online',
    items: 4,
    total: 74.90,
    channel: 'Delivery',
    elapsed: '11m',
    status: 'ready'
  }, {
    id: 'ORD-4816',
    table: 'T08',
    items: 6,
    total: 188.40,
    channel: 'Dine-in',
    elapsed: '14m',
    status: 'ready'
  }, {
    id: 'ORD-4815',
    table: 'T02',
    items: 2,
    total: 44.00,
    channel: 'Dine-in',
    elapsed: '22m',
    status: 'completed'
  }],
  activity: [{
    who: 'Marcus O.',
    what: 'seated at table T12',
    when: '2 min ago',
    tone: 'primary',
    icon: 'check'
  }, {
    who: 'Kitchen-2 printer',
    what: 'went offline',
    when: '8 min ago',
    tone: 'warning',
    icon: 'printer'
  }, {
    who: 'ORD-4817',
    what: 'marked ready for delivery',
    when: '11 min ago',
    tone: 'success',
    icon: 'orders'
  }, {
    who: 'Square POS',
    what: 'sync completed · 1,204 items',
    when: '15 min ago',
    tone: 'info',
    icon: 'sync'
  }, {
    who: 'Sofia Russo',
    what: 'marked as no-show',
    when: '18 min ago',
    tone: 'danger',
    icon: 'alert'
  }, {
    who: 'Lena P.',
    what: 'reservation confirmed',
    when: '24 min ago',
    tone: 'neutral',
    icon: 'calendar'
  }],
  systems: [{
    name: 'POS Sync · Square',
    status: 'healthy',
    detail: 'Last sync 15m ago'
  }, {
    name: 'Kitchen Display System',
    status: 'healthy',
    detail: '4 stations online'
  }, {
    name: 'WindowKiosk',
    status: 'syncing',
    detail: 'Reconnecting…',
    code: 'kiosk-window'
  }, {
    name: 'TableStation',
    status: 'healthy',
    detail: 'Online',
    code: 'kiosk-table'
  }, {
    name: 'Printer · Kitchen-2',
    status: 'warning',
    detail: 'No response 8m'
  }, {
    name: 'Payment Gateway',
    status: 'healthy',
    detail: 'Stripe · operational'
  }],
  transactions: [{
    id: 'TXN-90412',
    guest: 'Marcus Okonjo',
    method: 'Visa ••4821',
    amount: 142.50,
    type: 'Sale',
    time: '6:42 PM',
    status: 'completed'
  }, {
    id: 'TXN-90411',
    guest: 'Lena Park',
    method: 'Amex ••1009',
    amount: 58.00,
    type: 'Sale',
    time: '6:31 PM',
    status: 'completed'
  }, {
    id: 'TXN-90410',
    guest: 'Walk-in',
    method: 'Cash',
    amount: 24.00,
    type: 'Sale',
    time: '6:20 PM',
    status: 'completed'
  }, {
    id: 'TXN-90409',
    guest: 'Diego Alvarez',
    method: 'Visa ••3375',
    amount: 35.00,
    type: 'Deposit',
    time: '5:58 PM',
    status: 'completed'
  }, {
    id: 'TXN-90408',
    guest: 'Nora Hassan',
    method: 'Mastercard ••7781',
    amount: 44.00,
    type: 'Refund',
    time: '5:40 PM',
    status: 'failed'
  }, {
    id: 'TXN-90407',
    guest: 'Kenji Watanabe',
    method: 'Apple Pay',
    amount: 96.25,
    type: 'Sale',
    time: '5:22 PM',
    status: 'completed'
  }],
  kitchenStations: [{
    name: 'Grill',
    active: 4,
    load: 82,
    avg: '12:40'
  }, {
    name: 'Sauté',
    active: 3,
    load: 64,
    avg: '09:10'
  }, {
    name: 'Cold / Salad',
    active: 2,
    load: 38,
    avg: '04:25'
  }, {
    name: 'Pastry',
    active: 1,
    load: 22,
    avg: '06:50'
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/data.jsx", error: String((e && e.message) || e) }); }

// ui_kits/admin/icons.jsx
try { (() => {
/* Verdura icon set — Lucide path data (ISC) as inline React components.
   Consistent 24×24, 2px stroke, currentColor. Shared across the UI kit. */
const Svg = p => React.createElement('svg', {
  width: p.size || 18,
  height: p.size || 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: p.sw || 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  style: p.style
}, p.children);
const P = (d, key) => React.createElement('path', {
  d,
  key
});
const C = (cx, cy, r, key) => React.createElement('circle', {
  cx,
  cy,
  r,
  key
});
const R = (x, y, w, h, rx, key) => React.createElement('rect', {
  x,
  y,
  width: w,
  height: h,
  rx,
  key
});
const Icon = {
  dashboard: p => /*#__PURE__*/React.createElement(Svg, p, [R(3, 3, 7, 9, 1, 'a'), R(14, 3, 7, 5, 1, 'b'), R(14, 12, 7, 9, 1, 'c'), R(3, 16, 7, 5, 1, 'd')]),
  calendar: p => /*#__PURE__*/React.createElement(Svg, p, [R(3, 4, 18, 18, 2, 'a'), P('M16 2v4M8 2v4M3 10h18', 'b')]),
  orders: p => /*#__PURE__*/React.createElement(Svg, p, [P('M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z', 'a'), P('M3 6h18', 'b'), P('M16 10a4 4 0 0 1-8 0', 'c')]),
  kitchen: p => /*#__PURE__*/React.createElement(Svg, p, [P('M8.5 8.5 5 5M5 5 3 7l3.5 3.5M6.5 11 11 6.5', 'a'), P('M14 8a3.5 3.5 0 1 1 5 5l-2 2-9 9-3-3 9-9Z', 'b')]),
  menu: p => /*#__PURE__*/React.createElement(Svg, p, [P('M3 11h18M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4', 'a'), P('M5 11l1 9h12l1-9', 'b'), P('M9 16h6', 'c')]),
  payments: p => /*#__PURE__*/React.createElement(Svg, p, [R(2, 5, 20, 14, 2, 'a'), P('M2 10h20', 'b')]),
  staff: p => /*#__PURE__*/React.createElement(Svg, p, [P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'a'), C(9, 7, 4, 'b'), P('M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', 'c')]),
  venues: p => /*#__PURE__*/React.createElement(Svg, p, [P('M3 21h18M5 21V7l8-4v18M19 21V11l-6-3', 'a'), P('M9 9v.01M9 12v.01M9 15v.01M9 18v.01', 'b')]),
  printer: p => /*#__PURE__*/React.createElement(Svg, p, [P('M6 9V2h12v7', 'a'), P('M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'b'), R(6, 14, 12, 8, 1, 'c')]),
  sync: p => /*#__PURE__*/React.createElement(Svg, p, [P('M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'a'), P('M3 3v5h5', 'b'), P('M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16', 'c'), P('M21 21v-5h-5', 'd')]),
  audit: p => /*#__PURE__*/React.createElement(Svg, p, [P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'a'), P('M14 2v6h6M16 13H8M16 17H8M10 9H8', 'b')]),
  reports: p => /*#__PURE__*/React.createElement(Svg, p, [P('M3 3v18h18', 'a'), P('M18 17V9M13 17V5M8 17v-3', 'b')]),
  settings: p => /*#__PURE__*/React.createElement(Svg, p, [C(12, 12, 3, 'a'), P('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z', 'b')]),
  search: p => /*#__PURE__*/React.createElement(Svg, p, [C(11, 11, 7, 'a'), P('m21 21-4.3-4.3', 'b')]),
  bell: p => /*#__PURE__*/React.createElement(Svg, p, [P('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'a'), P('M10.3 21a1.94 1.94 0 0 0 3.4 0', 'b')]),
  plus: p => /*#__PURE__*/React.createElement(Svg, p, [P('M12 5v14M5 12h14', 'a')]),
  filter: p => /*#__PURE__*/React.createElement(Svg, p, [P('M3 4h18l-7 8v6l-4 2v-8Z', 'a')]),
  download: p => /*#__PURE__*/React.createElement(Svg, p, [P('M12 3v12M7 10l5 5 5-5', 'a'), P('M5 21h14', 'b')]),
  more: p => /*#__PURE__*/React.createElement(Svg, p, [C(12, 5, 1, 'a'), C(12, 12, 1, 'b'), C(12, 19, 1, 'c')]),
  dollar: p => /*#__PURE__*/React.createElement(Svg, p, [P('M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', 'a')]),
  clock: p => /*#__PURE__*/React.createElement(Svg, p, [C(12, 12, 9, 'a'), P('M12 7v5l3 2', 'b')]),
  users: p => /*#__PURE__*/React.createElement(Svg, p, [P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'a'), C(9, 7, 4, 'b')]),
  check: p => /*#__PURE__*/React.createElement(Svg, p, [P('M20 6 9 17l-5-5', 'a')]),
  alert: p => /*#__PURE__*/React.createElement(Svg, p, [P('M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z', 'a'), P('M12 9v4M12 17h.01', 'b')]),
  trend: p => /*#__PURE__*/React.createElement(Svg, p, [P('M22 7 13.5 15.5l-5-5L2 17', 'a'), P('M16 7h6v6', 'b')]),
  chevDown: p => /*#__PURE__*/React.createElement(Svg, p, [P('M6 9l6 6 6-6', 'a')]),
  utensils: p => /*#__PURE__*/React.createElement(Svg, p, [P('M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2M5 2v20M21 15V2a5 5 0 0 0-3 5v6c0 1.1.9 2 2 2h1Zm0 0v7', 'a')]),
  flame: p => /*#__PURE__*/React.createElement(Svg, p, [P('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z', 'a')]),
  mapPin: p => /*#__PURE__*/React.createElement(Svg, p, [P('M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z', 'a'), C(12, 10, 3, 'b')]),
  receipt: p => /*#__PURE__*/React.createElement(Svg, p, [P('M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z', 'a'), P('M8 7h8M8 11h8M8 15h5', 'b')]),
  arrowRight: p => /*#__PURE__*/React.createElement(Svg, p, [P('M5 12h14M13 6l6 6-6 6', 'a')]),
  logout: p => /*#__PURE__*/React.createElement(Svg, p, [P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9', 'a')]),
  architecture: p => /*#__PURE__*/React.createElement(Svg, p, [R(3, 3, 6, 6, 1, 'a'), R(3, 15, 6, 6, 1, 'b'), R(15, 9, 6, 6, 1, 'c'), P('M9 6h3v12H9M12 12h3', 'd')])
};
window.Icon = Icon;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/admin/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CardHeader = __ds_scope.CardHeader;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.Pagination = __ds_scope.Pagination;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Sidebar = __ds_scope.Sidebar;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.TopBar = __ds_scope.TopBar;

})();
