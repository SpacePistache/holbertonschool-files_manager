import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mongodb from 'mongodb';

import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const { ObjectId } = mongodb;

class FilesController {
  static async postUpload(req, res) {
    try {
      const token = req.header('X-Token');
      const userId = await redisClient.get(`auth_${token}`);

      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const user = await dbClient.db.collection('users').findOne({
        _id: new ObjectId(userId),
      });

      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const {
        name, type, isPublic = false, data,
      } = req.body;
      const parentId = req.body.parentId || 0;

      if (!name) return res.status(400).json({ error: 'Missing name' });
      if (!type || !['folder', 'file', 'image'].includes(type)) {
        return res.status(400).json({ error: 'Missing type' });
      }
      if (type !== 'folder' && !data) return res.status(400).json({ error: 'Missing data' });

      // root can arrive as 0 or "0" depending on the client
      const isRoot = parentId === 0 || parentId === '0';
      let storedParentId = 0;

      if (!isRoot) {
        if (!ObjectId.isValid(parentId)) return res.status(400).json({ error: 'Parent not found' });

        const parent = await dbClient.db.collection('files').findOne({
          _id: new ObjectId(parentId),
        });

        if (!parent) return res.status(400).json({ error: 'Parent not found' });
        if (parent.type !== 'folder') return res.status(400).json({ error: 'Parent is not a folder' });

        storedParentId = new ObjectId(parentId);
      }

      const doc = {
        userId: user._id, // ObjectId, not the Redis string
        name,
        type,
        isPublic,
        parentId: storedParentId, // 0 at root, ObjectId otherwise
      };

      // what goes back to the client: id not _id, no localPath, parentId as 0 at root
      const respond = (insertedId) => res.status(201).json({
        id: insertedId.toString(),
        userId: user._id.toString(),
        name,
        type,
        isPublic,
        parentId: isRoot ? 0 : parentId,
      });

      if (type === 'folder') {
        const result = await dbClient.db.collection('files').insertOne(doc);
        return respond(result.insertedId);
      }

      const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

      const localPath = path.join(folderPath, uuidv4());
      fs.writeFileSync(localPath, Buffer.from(data, 'base64'));

      doc.localPath = localPath;

      const result = await dbClient.db.collection('files').insertOne(doc);
      return respond(result.insertedId);
    } catch (err) {
      console.error('postUpload failed:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  }
}

export default FilesController;
