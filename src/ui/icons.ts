// Inline SVG icons (stroke style, 24x24 viewBox). Original drawings, no
// third-party icon assets.

const svg = (body: string, cls = "icon") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>'),
  settings: svg(
    [0, 45, 90, 135, 180, 225, 270, 315]
      .map(
        (deg) =>
          `<rect x="10.3" y="1.6" width="3.4" height="4.2" rx="0.9" fill="currentColor" stroke="none" transform="rotate(${deg} 12 12)"/>`,
      )
      .join("") + '<circle cx="12" cy="12" r="6.6" stroke-width="2.6"/><circle cx="12" cy="12" r="2.4"/>',
  ),
  heart: svg(
    '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" fill="currentColor" stroke="none"/>',
    "icon heart",
  ),
  library: svg(
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/>',
  ),
  apps: svg(
    '<circle cx="6" cy="6" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  ),
  sound: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  muted: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  wifi: svg(
    '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.2a9.5 9.5 0 0 1 13 0M8.6 15.4a5 5 0 0 1 6.8 0"/><circle cx="12" cy="18.6" r="1.2" fill="currentColor"/>',
  ),
  ethernet: svg('<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M8 16v4M16 16v4M12 16v4M8 8v3M12 8v3M16 8v3"/>'),
  offline: svg('<path d="M2.5 9a14 14 0 0 1 19 0M8.6 15.4a5 5 0 0 1 6.8 0M3 3l18 18"/>'),
  power: svg('<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>'),
  switchUser: svg('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c.9-3.2 3.3-5 6-5s5.1 1.8 6 5"/><path d="M16 6h5l-2-2M21 10h-5l2 2"/>'),
  download: svg('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
};
