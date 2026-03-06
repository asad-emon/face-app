from service.model_registry import get_model_registry


def main():
    get_model_registry().preload_assets()


if __name__ == "__main__":
    main()
