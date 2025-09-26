from sqlalchemy.orm import Session
from . import models, schemas, security

def get_user_by_email(db: Session, email: str):
    return db.query(models.User).filter(models.User.email == email).first()

def create_user(db: Session, user: schemas.UserCreate):
    hashed_password = security.get_password_hash(user.password)
    db_user = models.User(email=user.email, hashed_password=hashed_password)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def create_face_model(db: Session, name: str, data: bytes, owner_id: int) -> models.FaceModel:
    db_model = models.FaceModel(name=name, data=data, owner_id=owner_id)
    db.add(db_model)
    db.commit()
    db.refresh(db_model)
    return db_model

def get_face_model(db: Session, model_id: int, owner_id: int) -> models.FaceModel:
    return db.query(models.FaceModel).filter(
        models.FaceModel.id == model_id, 
        models.FaceModel.owner_id == owner_id
    ).first()
    
def get_face_model_list(db: Session, owner_id: int, limit: int) -> models.FaceModel:
    return db.query(models.FaceModel).filter(models.FaceModel.owner_id == owner_id).limit(limit).all()

def create_input_image(db: Session, filename: str, data: bytes, owner_id: int) -> models.InputImage:
    db_image = models.InputImage(filename=filename, data=data, owner_id=owner_id)
    db.add(db_image)
    db.commit()
    db.refresh(db_image)
    return db_image

def get_input_image(db: Session, image_id: int, owner_id: int) -> models.InputImage:
    return db.query(models.InputImage).filter(
        models.InputImage.id == image_id,
        models.InputImage.owner_id == owner_id
    ).first()

def create_generated_image(db: Session, data: bytes, owner_id: int, input_image_id: int, face_model_id: int) -> models.GeneratedImage:
    db_image = models.GeneratedImage(
        data=data, 
        owner_id=owner_id, 
        input_image_id=input_image_id, 
        face_model_id=face_model_id
    )
    db.add(db_image)
    db.commit()
    db.refresh(db_image)
    return db_image

def get_generated_images(db: Session, owner_id: int, skip: int = 0, limit: int = 100) -> list[models.GeneratedImage]:
    return db.query(models.GeneratedImage).filter(models.GeneratedImage.owner_id == owner_id).offset(skip).limit(limit).all()
