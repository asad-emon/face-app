from fastapi import Depends, FastAPI, HTTPException, UploadFile, File, Form
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List
import io
import numpy as np
from PIL import Image
import base64
from safetensors.numpy import save as save_safetensor
from safetensors import safe_open
from datetime import timedelta
from jose import JWTError, jwt

from . import crud, models, schemas, security
from .database import SessionLocal, engine
from .swapper import swap_faces
from .face_models import FACE_ANALYZER

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def get_current_user(db: Session = Depends(get_db), token: str = Depends(security.oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = schemas.TokenData(email=email)
    except JWTError:
        raise credentials_exception
    user = crud.get_user_by_email(db, email=token_data.email)
    if user is None:
        raise credentials_exception
    return user

@app.post("/token", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = crud.get_user_by_email(db, email=form_data.username)
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=security.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/users/", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    return crud.create_user(db=db, user=user)

@app.post("/models/generate/", response_model=schemas.FaceModel)
async def generate_model(
    files: List[UploadFile] = File(...),
    name: str = Form(...),
    db: Session = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user)
):
    embeddings = []
    for file in files:
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data))
        img_np = np.array(image)
        faces = FACE_ANALYZER.get(img_np)
        if len(faces) > 0:
            embeddings.append(faces[0].normed_embedding)

    if not embeddings:
        raise HTTPException(status_code=400, detail="No faces found in the uploaded images.")

    avg_embedding = np.mean(embeddings, axis=0)
    
    tensor_data = {"embedding": avg_embedding}
    safetensor_bytes = save_safetensor(tensor_data)

    return crud.create_face_model(db=db, name=name, data=safetensor_bytes, owner_id=current_user.id)

@app.post("/swap/")
async def swap(
    model_id: int, 
    image_id: int, 
    db: Session = Depends(get_db), 
    current_user: schemas.User = Depends(get_current_user)
):
    model = crud.get_face_model(db, model_id=model_id, owner_id=current_user.id)
    image = crud.get_input_image(db, image_id=image_id, owner_id=current_user.id)

    if not model or not image:
        raise HTTPException(status_code=404, detail="Model or image not found")

    with safe_open(io.BytesIO(model.data), framework="np", device="cpu") as f:
        source_embedding = f.get_tensor("embedding")

    input_image = Image.open(io.BytesIO(image.data))
    
    output_image = swap_faces(input_image, source_embedding=source_embedding)
    
    buffered = io.BytesIO()
    output_image.save(buffered, format="JPEG")
    img_data = buffered.getvalue()

    crud.create_generated_image(
        db=db, 
        data=img_data, 
        owner_id=current_user.id, 
        input_image_id=image_id, 
        face_model_id=model_id
    )

    return {"result": f"data:image/jpeg;base64,{base64.b64encode(img_data).decode('utf-8')}"}

@app.get("/images/generated/", response_model=List[schemas.GeneratedImage])
def get_generated_images(
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db), 
    current_user: schemas.User = Depends(get_current_user)
):
    images = crud.get_generated_images(db, owner_id=current_user.id, skip=skip, limit=limit)
    return images