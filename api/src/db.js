import mongoose from "mongoose";

const { Schema } = mongoose;

const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/face_app";

mongoose.set("strictQuery", true);

const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", counterSchema);

async function nextSequence(name) {
  const counter = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

function attachAutoIncrement(schema, name) {
  schema.pre("save", async function preSaveAutoInc() {
    if (this.isNew && (this.id === undefined || this.id === null)) {
      this.id = await nextSequence(name);
    }
  });
}

const userSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    email: { type: String, required: true, unique: true },
    hashed_password: { type: String, default: null },
    google_id: { type: String, unique: true, sparse: true, index: true },
    google_refresh_token: { type: String, default: null },
    google_name: { type: String, default: "" },
    google_picture: { type: String, default: "" },
  },
  { collection: "users", versionKey: false }
);
attachAutoIncrement(userSchema, "users");

const faceModelSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    name: { type: String, required: true },
    person_name: { type: String, required: true, default: "" },
    version: { type: Number, required: true, default: 1 },
    is_active: { type: Boolean, required: true, default: true },
    is_deleted: { type: Boolean, required: true, default: false },
    drive_file_id: { type: String, required: true },
    mime_type: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    owner_id: { type: Number, required: true, index: true },
  },
  { collection: "face_models", versionKey: false }
);
attachAutoIncrement(faceModelSchema, "face_models");

const inputImageSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    filename: { type: String, required: true },
    drive_file_id: { type: String, required: true },
    mime_type: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    owner_id: { type: Number, required: true, index: true },
  },
  { collection: "input_images", versionKey: false }
);
attachAutoIncrement(inputImageSchema, "input_images");

const generatedImageSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    drive_file_id: { type: String, required: true },
    mime_type: { type: String, default: "image/jpeg" },
    size: { type: Number, default: 0 },
    owner_id: { type: Number, required: true, index: true },
    input_image_id: { type: Number, required: true, index: true },
    face_model_id: { type: Number, required: true, index: true },
  },
  { collection: "generated_images", versionKey: false }
);
attachAutoIncrement(generatedImageSchema, "generated_images");

const generatedVideoSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    filename: { type: String, required: true, default: "generated.mp4" },
    mime_type: { type: String, required: true, default: "video/mp4" },
    processing: { type: Boolean, required: true, default: true },
    status: { type: String, required: true, default: "queued", index: true },
    error: { type: String, default: null },
    total_frames: { type: Number, required: true, default: 0 },
    processed_frames: { type: Number, required: true, default: 0 },
    progress_percent: { type: Number, required: true, default: 0 },
    drive_file_id: { type: String, default: null },
    input_drive_file_id: { type: String, default: null },
    input_mime_type: { type: String, default: "video/mp4" },
    input_size: { type: Number, default: 0 },
    size: { type: Number, default: 0 },
    owner_id: { type: Number, required: true, index: true },
    face_model_id: { type: Number, required: true, default: 0, index: true },
    enable_restore: { type: Boolean, required: true, default: false },
    expression_strength: { type: Number, required: true, default: 0.85 },
    started_at: { type: Date, default: null },
    finished_at: { type: Date, default: null },
  },
  {
    collection: "generated_videos",
    versionKey: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);
attachAutoIncrement(generatedVideoSchema, "generated_videos");

const swapJobSchema = new Schema(
  {
    id: { type: Number, unique: true, index: true },
    owner_id: { type: Number, required: true, index: true },
    face_model_id: { type: Number, required: true },
    input_image_id: { type: Number, required: true, index: true },
    enable_restore: { type: Boolean, required: true, default: false },
    status: { type: String, required: true, default: "queued", index: true },
    error: { type: String, default: null },
    generated_image_id: { type: Number, default: null },
    started_at: { type: Date, default: null },
    finished_at: { type: Date, default: null },
  },
  {
    collection: "swap_jobs",
    versionKey: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);
attachAutoIncrement(swapJobSchema, "swap_jobs");

export const User = mongoose.model("User", userSchema);
export const FaceModel = mongoose.model("FaceModel", faceModelSchema);
export const InputImage = mongoose.model("InputImage", inputImageSchema);
export const GeneratedImage = mongoose.model("GeneratedImage", generatedImageSchema);
export const GeneratedVideo = mongoose.model("GeneratedVideo", generatedVideoSchema);
export const SwapJob = mongoose.model("SwapJob", swapJobSchema);

export async function initDb() {
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  await Promise.all([
    User.syncIndexes(),
    FaceModel.syncIndexes(),
    InputImage.syncIndexes(),
    GeneratedImage.syncIndexes(),
    GeneratedVideo.syncIndexes(),
    SwapJob.syncIndexes(),
  ]);
}
