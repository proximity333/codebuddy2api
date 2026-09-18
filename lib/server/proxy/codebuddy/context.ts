import type { NextRequest } from 'next/server';

import { resolveRequestAccessKey } from '../auth';
import {
  type CredentialRecord,
  findEligibleCredentialRecordByFilename,
  findCredentialRecordByFilename,
  getCredentialProxySettings,
  resolveCredentialForRequest,
} from '../../domain/credentials';
import { getRequestHeaderMap } from '../../shared/http';
import { getCodeBuddyApiEndpoint } from '../../domain/config';
import type { ProxyContext } from './types';

export const getCredentialAffinityKey = (
  request: NextRequest,
  accessKeyId: string | null,
): string | undefined => {
  const incoming = getRequestHeaderMap(request.headers);
  const conversationId = incoming['x-conversation-id']?.trim();

  if (!conversationId) {
    return undefined;
  }

  if (accessKeyId) {
    return `access-key:${accessKeyId}:conversation:${conversationId}`;
  }

  return `global:conversation:${conversationId}`;
};

export const getCredentialValue = (
  value: unknown,
  candidateKeys: string[],
): string | number | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = getCredentialValue(item, candidateKeys);

      if (nested !== null && nested !== '') {
        return nested;
      }
    }

    return null;
  }

  if (value && typeof value === 'object') {
    for (const key of candidateKeys) {
      const direct = (value as Record<string, unknown>)[key];

      if (direct !== undefined && direct !== null && direct !== '') {
        return direct as string | number;
      }
    }

    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      const nested = getCredentialValue(nestedValue, candidateKeys);

      if (nested !== null && nested !== '') {
        return nested;
      }
    }
  }

  return null;
};

/**
 * Resolve the upstream API base URL for a credential's domain.
 *
 * CodeBuddy serves several domains from separate backends, so the credential
 * decides where its requests go: workbuddy and codebuddy.ai have their own
 * hosts, while domestic copilot.tencent.com / codebuddy.cn credentials share
 * one. Anything else falls back to the configured endpoint.
 */
export const getApiEndpointForCredential = async (
  credentialData: Record<string, unknown>,
): Promise<string> => {
  const domain = String(getCredentialValue(credentialData, ['domain']) ?? '')
    .trim()
    .toLowerCase();

  if (domain.endsWith('workbuddy.ai')) {
    return 'https://www.workbuddy.ai';
  }

  if (domain.endsWith('codebuddy.ai')) {
    return 'https://www.codebuddy.ai';
  }

  if (domain.endsWith('copilot.tencent.com') || domain.endsWith('codebuddy.cn')) {
    return 'https://copilot.tencent.com';
  }

  return getCodeBuddyApiEndpoint();
};

export const resolveProxyContext = async (
  request: NextRequest,
  model?: string,
): Promise<ProxyContext> => {
  const accessKey = await resolveRequestAccessKey(request);
  const credential = await resolveCredentialForRequest({
    accessKeyId: accessKey?.id,
    affinityKey: getCredentialAffinityKey(request, accessKey?.id ?? null),
    allowedCredentialFilenames: accessKey?.credentialFilenames,
    model,
  });

  if (!credential) {
    throw new Error('No valid CodeBuddy credentials found');
  }

  const bearerToken = String(
    credential.data.bearer_token ?? credential.data.access_token ?? '',
  ).trim();

  if (!bearerToken) {
    throw new Error('Saved credential does not include a bearer token');
  }

  return {
    accessKeyId: accessKey?.id ?? null,
    accessKeyName: accessKey?.name ?? null,
    auth: {
      type: 'bearer',
      bearerToken,
      userId: String(credential.data.user_id ?? 'unknown'),
      credentialData: credential.data,
    },
    credentialFilename: credential.filename,
    preferences: getCredentialProxySettings(credential.data),
  };
};

export const createProxyContextFromCredential = (
  credential: CredentialRecord,
): ProxyContext => {
  const bearerToken = String(
    credential.data.bearer_token ?? credential.data.access_token ?? '',
  ).trim();

  if (!bearerToken) {
    throw new Error('Saved credential does not include a bearer token');
  }

  return {
    accessKeyId: null,
    accessKeyName: null,
    auth: {
      type: 'bearer',
      bearerToken,
      userId: String(credential.data.user_id ?? 'unknown'),
      credentialData: credential.data,
    },
    credentialFilename: credential.filename,
    preferences: getCredentialProxySettings(credential.data),
  };
};

export const resolveProxyContextByCredentialFilename = async (
  filename: string,
  options?: {
    accessKey?: {
      id?: string | null;
      name?: string | null;
    };
    allowedCredentialFilenames?: string[];
    requireEligible?: boolean;
  },
): Promise<ProxyContext> => {
  const credential = options?.requireEligible
    ? await findEligibleCredentialRecordByFilename(
        filename,
        options.allowedCredentialFilenames,
      )
    : await findCredentialRecordByFilename(filename);

  if (!credential) {
    throw new Error('Selected credential was not found');
  }

  return {
    ...createProxyContextFromCredential(credential),
    accessKeyId: options?.accessKey?.id ?? null,
    accessKeyName: options?.accessKey?.name ?? null,
  };
};
