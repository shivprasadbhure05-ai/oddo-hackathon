from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.routers import auth, users, expenses

app = FastAPI(title="Reimbursement API", version="0.1.0")

# Allow frontend dev server during development.
# Lock this to your Vercel URL in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(expenses.router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}


# Global exception handler — prevents raw Python tracebacks from leaking in production
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": "An unexpected server error occurred", "code": "INTERNAL_SERVER_ERROR"}
    )
