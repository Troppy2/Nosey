import React from 'react';

interface LearningModeIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export const LearningModeIcon: React.FC<LearningModeIconProps> = ({
  size = 24,
  color = 'currentColor',
  className = '',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Original joined-loop silhouette; only the stem is lengthened. */}
      <circle cx="9" cy="9" r="3.5" />
      <circle cx="15" cy="9" r="3.5" />
      <path d="M12 12.5v3.5" />
      <path d="M9 9h6" opacity="0.4" />
    </svg>
  );
};

export default LearningModeIcon;
