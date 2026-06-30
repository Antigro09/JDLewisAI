export const TRADES = [
  "Electrical",
  "Plumbing",
  "HVAC",
  "Mechanical",
  "Roofing",
  "Concrete",
  "Masonry",
  "Structural Steel",
  "Framing",
  "Drywall",
  "Painting",
  "Flooring",
  "Tile",
  "Doors & Hardware",
  "Glazing",
  "Fire Protection",
  "Fire Alarm",
  "Low Voltage",
  "Security",
  "Landscaping",
  "Site Utilities",
  "Earthwork",
  "Asphalt",
  "Demolition",
  "Elevators",
  "Millwork",
  "Insulation",
  "Waterproofing",
  "EIFS",
  "Acoustical Ceilings",
  "Equipment",
  "Signage",
] as const;

export type Trade = (typeof TRADES)[number];

export function isTrade(value: string): value is Trade {
  return (TRADES as readonly string[]).includes(value);
}
