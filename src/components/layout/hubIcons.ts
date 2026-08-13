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
 * One glyph per `NavHubIconKey`, shared by every surface that renders a
 * `NavHubLink`: the hub pages (`HubNavLink`) and the desktop Tools menu
 * (`ToolsNavMenu`). Its own module so the menu doesn't have to pull the hub
 * card — and its route-transition machinery — into the top rail's bundle.
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
