from sqlalchemy import Column, Integer, String, LargeBinary, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)

    face_models = relationship("FaceModel", back_populates="owner")
    input_images = relationship("InputImage", back_populates="owner")
    generated_images = relationship("GeneratedImage", back_populates="owner")

class FaceModel(Base):
    __tablename__ = "face_models"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    data = Column(LargeBinary)
    owner_id = Column(Integer, ForeignKey("users.id"))

    owner = relationship("User", back_populates="face_models")

class InputImage(Base):
    __tablename__ = "input_images"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, index=True)
    data = Column(LargeBinary)
    owner_id = Column(Integer, ForeignKey("users.id"))

    owner = relationship("User", back_populates="input_images")

class GeneratedImage(Base):
    __tablename__ = "generated_images"

    id = Column(Integer, primary_key=True, index=True)
    data = Column(LargeBinary)
    owner_id = Column(Integer, ForeignKey("users.id"))
    input_image_id = Column(Integer, ForeignKey("input_images.id"))
    face_model_id = Column(Integer, ForeignKey("face_models.id"))

    owner = relationship("User", back_populates="generated_images")
    input_image = relationship("InputImage")
    face_model = relationship("FaceModel")