from pydantic import BaseModel
from typing import List, Optional

class UserCreate(BaseModel):
    email: str
    password: str

class User(BaseModel):
    id: int
    email: str

    class Config:
        orm_mode = True

class FaceModel(BaseModel):
    id: int
    name: str
    owner_id: int

    class Config:
        orm_mode = True

class InputImage(BaseModel):
    id: int
    filename: str
    owner_id: int

    class Config:
        orm_mode = True

class GeneratedImage(BaseModel):
    id: int
    owner_id: int
    input_image_id: int
    face_model_id: int

    class Config:
        orm_mode = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None
