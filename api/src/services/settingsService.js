import { UserSettings } from "../db.js";

const DEFAULTS = {
  save_input_files: true,
  expression_restore_enabled: true,
};

// Returns the caller's settings document, creating it with defaults on first
// access. Uses .create() (not an upsert) so the auto-increment pre-save hook
// runs and populates `id`; a concurrent create is caught via the duplicate-key
// error and resolved by re-reading.
export async function getUserSettings(ownerId) {
  const existing = await UserSettings.findOne({ owner_id: ownerId });
  if (existing) {
    return existing;
  }
  try {
    return await UserSettings.create({ owner_id: ownerId, ...DEFAULTS });
  } catch (err) {
    if (err && err.code === 11000) {
      return UserSettings.findOne({ owner_id: ownerId });
    }
    throw err;
  }
}

export function getSettingsDefaults() {
  return { ...DEFAULTS };
}
