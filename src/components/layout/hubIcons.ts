import type { LucideIcon } from "lucide-react";
import {
  Calendar,
  Car,
  CircleDot,
  Disc,
  FlaskConical,
  GitCompare,
  History,
  Layers,
  MapPin,
  Video,
  Wrench,
} from "lucide-react";
import type { NavHubIconKey } from "@/components/layout/navConfig";

/**
 * One glyph per `NavHubIconKey`, for every surface that renders a `NavHubLink` — which since
 * 2026-08-19 means the Settings catalog rows and nothing else.
 *
 * It was split out so the desktop Tools dropdown (`ToolsNavMenu`) could render hub icons without
 * pulling `HubNavLink` and its route-transition machinery into the top rail's bundle. Both that
 * menu and the two hub-link lists it fed are gone; the split is kept because the map is data and
 * `HubNavLink` is a component, and rejoining them buys nothing.
 */
export const HUB_ICON_MAP: Record<NavHubIconKey, LucideIcon> = {
  car: Car,
  disc: Disc,
  layers: Layers,
  "map-pin": MapPin,
  "circle-dot": CircleDot,
  flask: FlaskConical,
  calendar: Calendar,
  history: History,
  video: Video,
  "git-compare": GitCompare,
  wrench: Wrench,
};
