export const bytes = (n: number) =>
  n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}K` : `${(n / 1048576).toFixed(1)}M`;
