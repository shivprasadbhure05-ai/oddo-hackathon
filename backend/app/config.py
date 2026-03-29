from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    JWT_SECRET: str
    EXCHANGE_API_KEY: str = ""
    OCR_SPACE_API_KEY: str = ""


settings = Settings()
