export function serializeUser(user) {
  return { id: user.id, email: user.email };
}

export function serializeFaceModel(model) {
  const personName = model.person_name || model.name;
  return {
    id: model.id,
    name: model.name,
    person_name: personName,
    version: model.version || 1,
    is_active: Boolean(model.is_active),
    is_deleted: Boolean(model.is_deleted),
    owner_id: model.owner_id,
  };
}

export function serializeInputImage(image, options = {}) {
  const includeData = Boolean(options.includeData);
  return {
    id: image.id,
    filename: image.filename,
    owner_id: image.owner_id,
    data: includeData && image.data ? Buffer.from(image.data).toString("base64") : undefined,
  };
}

export function serializeGeneratedImage(image) {
  return {
    id: image.id,
    owner_id: image.owner_id,
    data: image.data ? Buffer.from(image.data).toString("base64") : null,
    input_image_id: image.input_image_id,
    face_model_id: image.face_model_id,
  };
}

export function serializeGeneratedVideo(video) {
  const hasBinaryData = Boolean(video.data && Buffer.from(video.data).length > 0);
  return {
    id: video.id,
    owner_id: video.owner_id,
    face_model_id: video.face_model_id,
    filename: video.filename,
    mime_type: video.mime_type || "video/mp4",
    processing: Boolean(video.processing),
    total_frames: Number(video.total_frames) || 0,
    processed_frames: Number(video.processed_frames) || 0,
    progress_percent: Number(video.progress_percent) || 0,
    has_content: hasBinaryData,
  };
}

export function serializeSwapJob(job) {
  return {
    id: job.id,
    owner_id: job.owner_id,
    face_model_id: job.face_model_id,
    input_image_id: job.input_image_id,
    enable_restore: Boolean(job.enable_restore),
    status: job.status,
    error: job.error || null,
    generated_image_id: job.generated_image_id || null,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
    created_at: job.created_at || null,
    updated_at: job.updated_at || null,
  };
}
