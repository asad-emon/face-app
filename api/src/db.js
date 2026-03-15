import { Sequelize, DataTypes } from "sequelize";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5432/face_app";

export const sequelize = new Sequelize(DATABASE_URL, {
  dialect: "postgres",
  logging: false,
});

export const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    hashed_password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    tableName: "users",
    timestamps: false,
  }
);

export const FaceModel = sequelize.define(
  "FaceModel",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    person_name: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "",
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    data: {
      type: DataTypes.BLOB("long"),
      allowNull: false,
    },
    owner_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "face_models",
    timestamps: false,
  }
);

export const InputImage = sequelize.define(
  "InputImage",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    filename: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    data: {
      type: DataTypes.BLOB("long"),
      allowNull: false,
    },
    owner_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "input_images",
    timestamps: false,
  }
);

export const GeneratedImage = sequelize.define(
  "GeneratedImage",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    data: {
      type: DataTypes.BLOB("long"),
      allowNull: false,
    },
    owner_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    input_image_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    face_model_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "generated_images",
    timestamps: false,
  }
);

export const GeneratedVideo = sequelize.define(
  "GeneratedVideo",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    filename: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "generated.mp4",
    },
    mime_type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "video/mp4",
    },
    processing: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    total_frames: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    processed_frames: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    progress_percent: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    data: {
      type: DataTypes.BLOB("long"),
      allowNull: false,
    },
    owner_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    face_model_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "generated_videos",
    timestamps: false,
  }
);

export const SwapJob = sequelize.define(
  "SwapJob",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    owner_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    face_model_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    input_image_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    enable_restore: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "queued",
    },
    error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    generated_image_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    finished_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "swap_jobs",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

User.hasMany(FaceModel, { foreignKey: "owner_id" });
User.hasMany(InputImage, { foreignKey: "owner_id" });
User.hasMany(GeneratedImage, { foreignKey: "owner_id" });
User.hasMany(GeneratedVideo, { foreignKey: "owner_id" });
User.hasMany(SwapJob, { foreignKey: "owner_id" });

FaceModel.belongsTo(User, { foreignKey: "owner_id" });
InputImage.belongsTo(User, { foreignKey: "owner_id" });
GeneratedImage.belongsTo(User, { foreignKey: "owner_id" });
GeneratedVideo.belongsTo(User, { foreignKey: "owner_id" });
SwapJob.belongsTo(User, { foreignKey: "owner_id" });

export async function initDb() {
  await sequelize.authenticate();
  await sequelize.sync();

  // Backfill new versioning columns for existing databases created before this feature.
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable("face_models");

  if (!table.person_name) {
    await queryInterface.addColumn("face_models", "person_name", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "",
    });
    await sequelize.query(
      'UPDATE face_models SET person_name = COALESCE(NULLIF(name, \'\'), \'unknown\') WHERE person_name = \'\''
    );
  }

  if (!table.version) {
    await queryInterface.addColumn("face_models", "version", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
  }

  if (!table.is_active) {
    await queryInterface.addColumn("face_models", "is_active", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  }

  if (!table.is_deleted) {
    await queryInterface.addColumn("face_models", "is_deleted", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }

  const generatedVideoTable = await queryInterface.describeTable("generated_videos");
  if (!generatedVideoTable.filename) {
    await queryInterface.addColumn("generated_videos", "filename", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "generated.mp4",
    });
  }
  if (!generatedVideoTable.mime_type) {
    await queryInterface.addColumn("generated_videos", "mime_type", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "video/mp4",
    });
  }
  if (!generatedVideoTable.processing) {
    await queryInterface.addColumn("generated_videos", "processing", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await sequelize.query("UPDATE generated_videos SET processing = false WHERE processing IS NULL");
  }
  if (!generatedVideoTable.total_frames) {
    await queryInterface.addColumn("generated_videos", "total_frames", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  }
  if (!generatedVideoTable.processed_frames) {
    await queryInterface.addColumn("generated_videos", "processed_frames", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  }
  if (!generatedVideoTable.progress_percent) {
    await queryInterface.addColumn("generated_videos", "progress_percent", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  }
  if (!generatedVideoTable.face_model_id) {
    await queryInterface.addColumn("generated_videos", "face_model_id", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  }
}
