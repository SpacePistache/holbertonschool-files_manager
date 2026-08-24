import sha1 from 'sha1';
import { v4 as uuidv4 } from 'uuid';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

class AuthController {
  static async getConnect(req, res) {
    const auth = req.headers.authorization;

    if (!auth || !auth.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = Buffer.from(auth.split(' ')[1], 'base64')
      .toString();

    const sep = decoded.indexOf(':');
    const email = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);

    const user = await dbClient.db.collection('users').findOne({
      email,
      password: sha1(password),
    });

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    const token = uuidv4();

    await redisClient.set(
      `auth_${token}`,
      user._id.toString(),
      24 * 60 * 60,
    );

    return res.status(200).json({ token });
  }

  static async getDisconnect(req, res) {
    const token = req.header('X-Token');

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    const userId = await redisClient.get(`auth_${token}`);

    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    await redisClient.del(`auth_${token}`);

    return res.status(204).send();
  }
}

export default AuthController;
