import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { of, catchError, firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';

@Injectable()
export class BanPlateformService {
  private readonly banApiUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {
    this.banApiUrl = this.configService.get<string>('BAN_API_URL') || '';
  }

  public async getBanAssemblage(codeCommune: string): Promise<Buffer> {
    if (!this.banApiUrl) {
      this.logger.warn(
        'BAN_API_URL not configured — returning null for assemblage',
        BanPlateformService.name,
      );
      return null;
    }

    const { data } = await firstValueFrom(
      await this.httpService
        .get<Buffer>(`/ban/communes/${codeCommune}/download/csv-bal/adresses`, {
          responseType: 'arraybuffer',
        })
        .pipe(
          catchError((error: AxiosError) => {
            if (error.response && error.response.status === 404) {
              return of({ data: null });
            }
            throw error;
          }),
        ),
    );
    return data;
  }

  public async getIdBanCommune(codeCommune: string): Promise<string> {
    // If no BAN platform is configured, generate a local UUID
    // This allows local development without the BAN platform running
    if (!this.banApiUrl) {
      this.logger.warn(
        `BAN_API_URL not configured — generating local UUID for jurisdiction ${codeCommune}`,
        BanPlateformService.name,
      );
      return randomUUID();
    }

    try {
      const { data } = await firstValueFrom(
        await this.httpService
          .get<any>(`/api/district/cog/${codeCommune}`)
          .pipe(
            catchError((error: AxiosError) => {
              this.logger.error(
                `Unable to retrieve district code for jurisdiction ${codeCommune}`,
                error.response?.data || 'No server response',
                BanPlateformService.name,
              );
              throw new HttpException(
                (error.response?.data as any)?.message || 'No server response',
                HttpStatus.BAD_GATEWAY,
              );
            }),
          ),
      );

      return data.response[0].id;
    } catch (error) {
      // Fallback to local UUID if the BAN platform is unreachable
      this.logger.warn(
        `BAN platform unreachable — generating local UUID for jurisdiction ${codeCommune}`,
        BanPlateformService.name,
      );
      return randomUUID();
    }
  }
}
