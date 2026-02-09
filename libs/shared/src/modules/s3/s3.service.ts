import {
  PutObjectCommand,
  PutObjectCommandInput,
  PutObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3Service {
  private s3Client: S3Client | null = null;
  private readonly logger = new Logger(S3Service.name);

  constructor(private configService: ConfigService) {
    const region = this.configService.get<string>('S3_REGION');
    if (region) {
      this.s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId: this.configService.get<string>('S3_ACCESS_KEY'),
          secretAccessKey: this.configService.get<string>('S3_SECRET_KEY'),
        },
        endpoint: this.configService.get<string>('S3_ENDPOINT'),
      });
    } else {
      this.logger.warn(
        'S3_REGION not configured — file uploads will be disabled',
      );
    }
  }

  public async uploadPublicFile(
    fileId: string,
    bucket: string,
    data: Buffer,
    options: Partial<PutObjectCommandInput> = {},
  ): Promise<PutObjectCommandOutput> {
    if (!this.s3Client) {
      this.logger.warn(`S3 not configured — skipping upload of ${fileId}`);
      return {} as PutObjectCommandOutput;
    }
    return this.s3Client.send(
      new PutObjectCommand({
        ACL: 'public-read',
        Bucket: bucket,
        Key: fileId,
        Body: data,
        ...options,
      }),
    );
  }
}
