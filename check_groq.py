import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()
api_key = os.getenv("GROQ_API_KEY", "").strip()

print("=" * 60)
print("TripMate AI - Groq Model Diagnostic")
print("=" * 60)

if not api_key:
    print("❌ ERROR: GROQ_API_KEY is empty in .env")
    exit(1)

print(f"API Key: {api_key[:8]}...{api_key[-4:]} (Length: {len(api_key)})")

client = Groq(api_key=api_key)

try:
    models_response = client.models.list()
    available_models = [m.id for m in models_response.data if getattr(m, "active", True)]
    print(f"\n✅ Connection successful! Found {len(available_models)} accessible model(s):\n")
    for model_id in sorted(available_models):
        print(f"  • {model_id}")

    if available_models:
        rec = "llama-3.1-8b-instant" if "llama-3.1-8b-instant" in available_models else available_models[0]
        print(f"\n👉 Recommended setting in .env:")
        print(f"GROQ_MODEL={rec}")

except Exception as exc:
    print(f"\n❌ Groq API error: {exc}")
    print("\nPossible causes:")
    print("1. Your Groq account might have reached its monthly free limit or quota.")
    print("2. The key was created under a restricted Project on console.groq.com.")
    print("3. Try creating a fresh API key at: https://console.groq.com/keys")
