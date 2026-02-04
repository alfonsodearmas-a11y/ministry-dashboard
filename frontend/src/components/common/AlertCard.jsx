import React from 'react';
import { AlertTriangle, AlertCircle, X, ChevronRight } from 'lucide-react';

const AlertCard = ({ alert, onDismiss, onAction }) => {
  const severityStyles = {
    critical: {
      bg: 'bg-red-500/[0.08]',
      border: 'border-red-500/30',
      icon: 'text-red-400',
      badge: 'bg-red-500/[0.15] text-red-300',
    },
    warning: {
      bg: 'bg-amber-500/[0.08]',
      border: 'border-amber-500/30',
      icon: 'text-amber-400',
      badge: 'bg-amber-500/[0.15] text-amber-300',
    },
  };

  const styles = severityStyles[alert.severity] || severityStyles.warning;
  const Icon = alert.severity === 'critical' ? AlertTriangle : AlertCircle;

  return (
    <div className={`${styles.bg} ${styles.border} border rounded-xl p-4 transition-all hover:scale-[1.01]`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${styles.badge}`}>
          <Icon size={20} className={styles.icon} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${styles.badge}`}>
              {alert.agency?.toUpperCase() || 'SYSTEM'}
            </span>
            <span className="text-[#64748b] text-xs">{alert.time || 'Just now'}</span>
          </div>
          <p className="text-[#f1f5f9] font-medium">{alert.message}</p>
          {alert.detail && (
            <p className="text-[#94a3b8] text-sm mt-1">{alert.detail}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onAction && (
            <button
              onClick={() => onAction(alert)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#243049] hover:bg-[#d4af37]/20 text-[#f1f5f9] text-sm transition-colors"
            >
              View <ChevronRight size={14} />
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => onDismiss(alert)}
              className="p-1.5 rounded-lg hover:bg-[#243049] text-[#94a3b8] hover:text-[#f1f5f9] transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AlertCard;
