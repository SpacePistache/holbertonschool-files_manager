import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mongodb from 'mongodb';

import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const { ObjectId } = mongodb;

const formatFile = (doc) => ({
  id: doc._id.toString(),
  userId: doc.userId.toString(),
  name: doc.name,
  type: doc.type,
  isPublic: doc.isPublic,
  parentId: doc.parentId === 0 || doc.parentId === '0' ? 0 : doc.parentId.toString(),
});

const getUserFromToken = async (req) => {
  const token = req.header('X-Token');
  if (!token) return null;
  const userId = await redisClient.get(`auth_${token}`);
  if (!userId || !ObjectId.isValid(userId)) return null;
  return dbClient.db.collection('users').findOne({ _id: new ObjectId(userId) });
};

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

      const isRoot = parentId === 0 || parentId === '0';
      let storedParentId = 0;

      if (!isRoot) {
        if (!ObjectId.isValid(parentId)) return res.status(400).json({ error: 'Parent not found' });

        const parent = await dbClient.db.collection('files').findOne({
          _id: new ObjectId(parentId),
        });

        if (!parent) return res.status(400).json({ error: 'Parent not found' });
        if (parent.type !== 'folder') {
          return res.status(400).json({ error: 'Parent is not a folder' });
        }

        storedParentId = new ObjectId(parentId);
      }

      const doc = {
        userId: user._id,
        name,
        type,
        isPublic,
        parentId: storedParentId,
      };

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

  static async getShow(req, res) {
    try {
      const user = await getUserFromToken(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { id } = req.params;
      if (!ObjectId.isValid(id)) return res.status(404).json({ error: 'Not found' });

      const file = await dbClient.db.collection('files').findOne({
        _id: new ObjectId(id),
        userId: user._id,
      });

      if (!file) return res.status(404).json({ error: 'Not found' });

      return res.status(200).json(formatFile(file));
    } catch (err) {
      console.error('getShow failed:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  static async getIndex(req, res) {
    try {
      const user = await getUserFromToken(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const parentId = req.query.parentId || '0';
      const page = Math.max(0, parseInt(req.query.page, 10) || 0);
      const isRoot = parentId === '0' || parentId === 0;

      if (!isRoot && !ObjectId.isValid(parentId)) return res.status(200).json([]);

      const match = {
        userId: user._id,
        parentId: isRoot ? 0 : new ObjectId(parentId),
      };

      const files = await dbClient.db.collection('files').aggregate([
        { $match: match },
        { $skip: page * 20 },
        { $limit: 20 },
      ]).toArray();

      return res.status(200).json(files.map(formatFile));
    } catch (err) {
      console.error('getIndex failed:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  static async setPublish(req, res, isPublic) {
    try {
      const user = await getUserFromToken(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { id } = req.params;
      if (!ObjectId.isValid(id)) return res.status(404).json({ error: 'Not found' });

      // findOneAndUpdate does the match and the write in one round trip
      const result = await dbClient.db.collection('files').findOneAndUpdate(
        { _id: new ObjectId(id), userId: user._id },
        { $set: { isPublic } },
        { returnOriginal: false }, // driver v3 option: give me the doc AFTER the update
      );

      if (!result.value) return res.status(404).json({ error: 'Not found' });

      return res.status(200).json(formatFile(result.value));
    } catch (err) {
      console.error('setPublish failed:', err);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  static async putPublish(req, res) {
    return FilesController.setPublish(req, res, true);
  }

  static async putUnpublish(req, res) {
    return FilesController.setPublish(req, res, false);
  }
}

export default FilesController;
