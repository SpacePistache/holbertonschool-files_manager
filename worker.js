import Bull from 'bull';
import imageThumbnail from 'image-thumbnail';
import { promises as fs } from 'fs';
import mongodb from 'mongodb';
import dbClient from './utils/db';

const { ObjectId } = mongodb;
const fileQueue = new Bull('fileQueue');

fileQueue.process(async (job) => {
  const { fileId, userId } = job.data;

  if (!fileId) throw new Error('Missing fileId');
  if (!userId) throw new Error('Missing userId');

  const file = await dbClient.db.collection('files').findOne({
    _id: new ObjectId(fileId),
    userId: new ObjectId(userId), // job data is strings; DB holds ObjectIds
  });

  if (!file) throw new Error('File not found');

  const sizes = [500, 250, 100];

  await Promise.all(sizes.map(async (width) => {
    const thumbnail = await imageThumbnail(file.localPath, { width });
    await fs.writeFile(`${file.localPath}_${width}`, thumbnail);
  }));
});

console.log('Worker started');
