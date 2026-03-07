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

User.hasMany(FaceModel, { foreignKey: "owner_id" });
User.hasMany(InputImage, { foreignKey: "owner_id" });
User.hasMany(GeneratedImage, { foreignKey: "owner_id" });

FaceModel.belongsTo(User, { foreignKey: "owner_id" });
InputImage.belongsTo(User, { foreignKey: "owner_id" });
GeneratedImage.belongsTo(User, { foreignKey: "owner_id" });

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
}
