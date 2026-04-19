import type { ReSpeakerApi } from "../shared/types";

declare global {
  interface Window {
    respeakerApi: ReSpeakerApi;
  }
}

export {};

