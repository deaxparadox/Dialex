// Ported from debate-thread.css's .typing-indicator (spec 0038).
export function TypingIndicator() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-ink-muted [animation:typing-bounce_1.1s_infinite_ease-in-out]"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}
