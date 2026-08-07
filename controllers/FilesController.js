import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mongodb from 'mongodb';

import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const { ObjectId } = mongodb;

class FilesController {
  static async postUpload(req, res) {
    // Authenticate user
    const token = req.header('X-Token');
    const userId = await redisClient.get(`auth_${token}`);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await dbClient.db.collection('users').findOne({
      _id: new ObjectId(userId),
    });

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve request body
    const {
      name,
      type,
      parentId = '0',
      isPublic = false,
      data,
    } = req.body;

    // Validate name
    if (!name) {
      return res.status(400).json({
        error: 'Missing name',
      });
    }

    // Validate type
    if (!type || !['folder', 'file', 'image'].includes(type)) {
      return res.status(400).json({
        error: 'Missing type',
      });
    }

    // Validate data
    if (type !== 'folder' && !data) {
      return res.status(400).json({
        error: 'Missing data',
      });
    }

    // Validate parent
    let storedParentId = '0';

    if (parentId !== '0') {
      const parent = await dbClient.db.collection('files').findOne({
        _id: new ObjectId(parentId),
      });

      if (!parent) {
        return res.status(400).json({
          error: 'Parent not found',
        });
      }

      if (parent.type !== 'folder') {
        return res.status(400).json({
          error: 'Parent is not a folder',
        });
      }

      storedParentId = new ObjectId(parentId);
    }

    // Folder creation
    if (type === 'folder') {
      const result = await dbClient.db.collection('files').insertOne({
        userId,
        name,
        type,
        isPublic,
        parentId: storedParentId,
      });

      return res.status(201).json({
        id: result.insertedId.toString(),
        userId,
        name,
        type,
        isPublic,
        parentId,
      });
    }

    // File/Image creation
    const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const filename = uuidv4();
    const localPath = path.join(folderPath, filename);

    fs.writeFileSync(localPath, Buffer.from(data, 'base64'));

    const result = await dbClient.db.collection('files').insertOne({
      userId,
      name,
      type,
      isPublic,
      parentId: storedParentId,
      localPath,
    });

    return res.status(201).json({
      id: result.insertedId.toString(),
      userId,
      name,
      type,
      isPublic,
      parentId,
    });
  }
}

export default FilesController;
