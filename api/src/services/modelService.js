import { FaceModel } from "../db.js";

export async function resolveVersion(ownerId, personName, requestedVersion) {
  if (requestedVersion !== null) {
    return requestedVersion;
  }

  const latestModel = await FaceModel.findOne({
    owner_id: ownerId,
    person_name: personName,
    is_deleted: false,
  })
    .sort({ version: -1 })
    .lean();
  const latestVersion = latestModel?.version || 0;
  return latestVersion + 1;
}

export async function setActiveModel(ownerId, personName, modelId) {
  await FaceModel.updateMany(
    {
      owner_id: ownerId,
      person_name: personName,
      is_deleted: false,
    },
    { $set: { is_active: false } }
  );

  await FaceModel.updateOne(
    {
      id: modelId,
      owner_id: ownerId,
      is_deleted: false,
    },
    { $set: { is_active: true } }
  );
}

export async function ensureActiveForPerson(ownerId, personName) {
  const activeModel = await FaceModel.findOne({
    owner_id: ownerId,
    person_name: personName,
    is_active: true,
    is_deleted: false,
  }).lean();
  if (activeModel) {
    return;
  }

  const fallbackModel = await FaceModel.findOne({
    owner_id: ownerId,
    person_name: personName,
    is_deleted: false,
  })
    .sort({ version: -1, id: -1 })
    .lean();
  if (!fallbackModel) {
    return;
  }

  await FaceModel.updateOne(
    {
      id: fallbackModel.id,
      owner_id: ownerId,
    },
    { $set: { is_active: true } }
  );
}
