interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  online?: boolean;
  className?: string;
}

const sizeMap = {
  xs: "w-6 h-6 text-xs",
  sm: "w-8 h-8 text-sm",
  md: "w-10 h-10 text-base",
  lg: "w-12 h-12 text-lg",
  xl: "w-16 h-16 text-xl",
};

const dotSizeMap = {
  xs: "w-2 h-2 border",
  sm: "w-2.5 h-2.5 border",
  md: "w-3 h-3 border-2",
  lg: "w-3.5 h-3.5 border-2",
  xl: "w-4 h-4 border-2",
};

export function Avatar({ src, name, size = "md", online, className = "" }: AvatarProps) {
  const initials = name ? name.slice(0, 2).toUpperCase() : "?";
  const sizeClass = sizeMap[size];
  const dotSizeClass = dotSizeMap[size];

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
      {online !== undefined && (
        <span className={`absolute bottom-0 right-0 ${dotSizeClass} rounded-full border-background ${online ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-zinc-500"}`} />
      )}
    </div>
  );
}
