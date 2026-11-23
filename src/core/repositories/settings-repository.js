import { BaseRepository } from "./base-repository.js";

export class SettingsRepository extends BaseRepository {
  constructor(options) {
    super({ ...options, storeName: "settings" });
  }
}
