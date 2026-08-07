import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mongodb from 'mongodb';

import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const { ObjectId } = mongodb;

class FilesController {
  static async postUpload(req, res) {
  const token = req.header('X-Token');

  const userId = await redisClient.get(`auth_${token}`);

  if (!userId) {
    return res.status(401).json({
      error: 'Unauthorized',
    });
  }

  const user = await dbClient.db.collection('users').findOne({
    _id: new ObjectId(userId),
  });

  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
    });
  }
}
}

export default FilesController;
