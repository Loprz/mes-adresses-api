import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Ng911Service } from '@/shared/modules/ng911/ng911.service';

@ApiTags('NG911 / NENA')
@Controller('ng911')
export class Ng911Controller {
  constructor(private readonly ng911Service: Ng911Service) {}

  @Get('export/:balId')
  @ApiOperation({
    summary: 'Export a LAB as NENA NG9-1-1 GIS layers (CSV)',
    description:
      'layer=ssap → Site/Structure Address Points (core + parsed street ' +
      'components + NG911 extension). layer=centerline → Road Centerline ' +
      'address ranges, using true left/right when the street has centerline ' +
      'geometry (voie.trace), falling back to odd/even parity ranges otherwise. ' +
      'See docs/NG911_SSAP_MAPPING.md.',
  })
  @ApiParam({ name: 'balId', description: 'Local Address Base ID' })
  @ApiQuery({
    name: 'layer',
    required: false,
    enum: ['ssap', 'centerline'],
    description: 'Which NG911 layer to export (default: ssap)',
  })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @Param('balId') balId: string,
    @Res() res: Response,
    @Query('layer') layer: 'ssap' | 'centerline' = 'ssap',
  ): Promise<void> {
    const result =
      layer === 'centerline'
        ? await this.ng911Service.exportCenterline(balId)
        : await this.ng911Service.exportSsap(balId);

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.csv);
  }
}
