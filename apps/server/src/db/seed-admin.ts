import argon2 from 'argon2';
import { eq } from 'drizzle-orm';

import { createDatabaseClient } from './client.js';
import { readDatabaseConfig } from './config.js';
import { users } from './schema.js';

type AdminSeedConfig = {
  login: string;
  password: string;
  displayName: string;
};

type Environment = Record<string, string | undefined>;

/**
 * Seeds or updates the active admin account from environment variables.
 */
export async function seedAdmin(env: Environment = process.env): Promise<void> {
  const adminConfig = readAdminSeedConfig(env);
  const database = createDatabaseClient(readDatabaseConfig(env));

  try {
    const passwordHash = await argon2.hash(adminConfig.password, {
      type: argon2.argon2id
    });

    // Upsert keeps local development repeatable while rotating the configured admin password.
    await database.db
      .insert(users)
      .values({
        login: adminConfig.login,
        passwordHash,
        displayName: adminConfig.displayName,
        role: 'admin',
        status: 'active',
        verifiedAt: new Date()
      })
      .onConflictDoUpdate({
        target: users.login,
        set: {
          passwordHash,
          displayName: adminConfig.displayName,
          role: 'admin',
          status: 'active',
          verifiedAt: new Date()
        }
      });

    console.log(`Admin account is ready: ${adminConfig.login}`);
  } finally {
    await database.close();
  }
}

/**
 * Reads admin credentials and refuses unsafe missing values.
 */
function readAdminSeedConfig(env: Environment): AdminSeedConfig {
  const login = env.ADMIN_LOGIN;
  const password = env.ADMIN_PASSWORD;
  const displayName = env.ADMIN_DISPLAY_NAME ?? 'Admin';

  if (!login || login.trim() === '') {
    throw new Error('ADMIN_LOGIN is required to seed the admin account.');
  }

  if (!password || password.trim() === '') {
    throw new Error('ADMIN_PASSWORD is required to seed the admin account.');
  }

  return {
    login,
    password,
    displayName
  };
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  seedAdmin().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

