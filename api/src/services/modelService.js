import { FaceModel } from "../db.js";

export async function resolveVersion(ownerId, personName, requestedVersion, transaction) {
  if (requestedVersion !== null) {
    return requestedVersion;
  }

  const latestModel = await FaceModel.findOne({
    where: {
      owner_id: ownerId,
      person_name: personName,
      is_deleted: false,
    },
    order: [["version", "DESC"]],
    transaction,
  });
  const latestVersion = latestModel?.version || 0;
  return latestVersion + 1;
}

export async function setActiveModel(ownerId, personName, modelId, transaction) {
  await FaceModel.update(
    { is_active: false },
    {
      where: {
        owner_id: ownerId,
        person_name: personName,
        is_deleted: false,
      },
      transaction,
    }
  );

  await FaceModel.update(
    { is_active: true },
    {
      where: {
        id: modelId,
        owner_id: ownerId,
        is_deleted: false,
      },
      transaction,
    }
  );
}

export async function ensureActiveForPerson(ownerId, personName, transaction) {
  const activeModel = await FaceModel.findOne({
    where: {
      owner_id: ownerId,
      person_name: personName,
      is_active: true,
      is_deleted: false,
    },
    transaction,
  });
  if (activeModel) {
    return;
  }

  const fallbackModel = await FaceModel.findOne({
    where: {
      owner_id: ownerId,
      person_name: personName,
      is_deleted: false,
    },
    order: [["version", "DESC"], ["id", "DESC"]],
    transaction,
  });
  if (!fallbackModel) {
    return;
  }

  await FaceModel.update(
    { is_active: true },
    {
      where: {
        id: fallbackModel.id,
        owner_id: ownerId,
      },
      transaction,
    }
  );
}
