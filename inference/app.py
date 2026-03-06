import uvicorn

from service.api import create_app
from service.settings import get_settings


app = create_app()


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=settings.port,
        reload=True,
        debug=True,
    )
