interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeMap = {
  xs: "w-6 h-6 text-xs",
  sm: "w-8 h-8 text-sm",
  md: "w-10 h-10 text-base",
  lg: "w-12 h-12 text-lg",
  xl: "w-16 h-16 text-xl",
};

export function Avatar({ src, name, size = "md", className = "" }: AvatarProps) {
  const initials = name ? name.slice(0, 2).toUpperCase() : "?";
  const sizeClass = sizeMap[size];

  const colors = [
    "from-blue-500 to-cyan-400",
    "from-violet-500 to-purple-400",
    "from-emerald-500 to-teal-400",
    "from-orange-500 to-amber-400",
    "from-rose-500 to-pink-400",
    "from-indigo-500 to-blue-400",
  ];
  const colorIndex = name ? name.charCodeAt(0) % colors.length : 0;
  const gradient = colors[colorIndex];

  return (
    <div className={`relative inline-flex flex-shrink-0 ${className}`}>
      <div className={`${sizeClass} rounded-full overflow-hidden ring-2 ring-white/10`}>
        {src ? (
          <img src={src} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-semibold`}>
            {initials}
          </div>
        )}
      </div>
    </div>
  );
}
