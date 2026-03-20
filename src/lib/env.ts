export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

export function requireDatabaseUrl() {
  if (!hasDatabaseUrl()) {
    throw new Error(
      "DATABASE_URL is not set. Create a .env file with DATABASE_URL (e.g. file:./dev.db for SQLite)."
    );
  }
}

