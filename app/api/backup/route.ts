import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const filePath = path.join(process.cwd(), 'public', 'taqreer_full_backup.tar.gz');
  
  try {
    const stat = fs.statSync(filePath);
    const fileStream = fs.createReadStream(filePath);
    
    // Convert fs.ReadStream to a Web ReadableStream
    const readableStream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => controller.close());
        fileStream.on('error', (err) => controller.error(err));
      },
    });

    return new NextResponse(readableStream, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': 'attachment; filename="taqreer_full_backup.tar.gz"',
        'Content-Length': stat.size.toString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
  }
}
