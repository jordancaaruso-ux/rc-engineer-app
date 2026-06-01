import type { GeoPosition } from "@/lib/location/coordinates";

export type GeolocationErrorCode = "unsupported" | "denied" | "unavailable" | "timeout";

export class GeolocationRequestError extends Error {
  code: GeolocationErrorCode;

  constructor(code: GeolocationErrorCode, message: string) {
    super(message);
    this.name = "GeolocationRequestError";
    this.code = code;
  }
}

/** One-shot device position for marking a track while on site. */
export function getCurrentPosition(options?: {
  timeoutMs?: number;
  maximumAgeMs?: number;
}): Promise<GeoPosition> {
  const timeoutMs = options?.timeoutMs ?? 12_000;
  const maximumAgeMs = options?.maximumAgeMs ?? 60_000;

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(
      new GeolocationRequestError(
        "unsupported",
        "Location is not available in this browser."
      )
    );
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new GeolocationRequestError(
              "denied",
              "Location permission was denied. You can enable it in browser settings and try again."
            )
          );
          return;
        }
        if (err.code === err.TIMEOUT) {
          reject(
            new GeolocationRequestError(
              "timeout",
              "Could not get your location in time. Try again when you have a clearer GPS signal."
            )
          );
          return;
        }
        reject(
          new GeolocationRequestError(
            "unavailable",
            "Your location could not be determined right now."
          )
        );
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: maximumAgeMs,
      }
    );
  });
}
