import type { NextFunction, Request, Response } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../../../firebase-applet-config.json' with { type: 'json' };

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  let token = '';
  const customHeader = req.headers['x-firebase-auth'];
  const authHeader = req.headers.authorization;
  if (typeof customHeader === 'string' && customHeader.trim().length > 20) {
    token = customHeader.trim();
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length).trim();
  } else if (typeof req.query.token === 'string' && req.query.token.length > 20) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in with Google.' });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;
    return next();
  } catch (err) {
    console.error('Firebase token verification failed:', err);
    return res.status(401).json({ error: 'Session expired or invalid authentication token.' });
  }
}
