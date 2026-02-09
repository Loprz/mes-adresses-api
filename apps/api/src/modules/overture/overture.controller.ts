import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OvertureService } from '@/shared/modules/overture/overture.service';
import { LinkGersDTO } from './dto/link_gers.dto';
import { BulkImportOvertureDTO } from './dto/bulk_import.dto';

@ApiTags('Overture Maps / GERS')
@Controller('overture')
export class OvertureController {
  private readonly logger = new Logger(OvertureController.name);

  constructor(private readonly overtureService: OvertureService) {}

  @Get('gers/:gersId')
  @ApiOperation({
    summary: 'Look up an address by its Overture GERS ID',
    description:
      'Reverse lookup from a GERS ID to find the corresponding NAP address. ' +
      'Enables external systems in the Overture ecosystem to resolve addresses.',
  })
  @ApiParam({
    name: 'gersId',
    description: 'Overture GERS ID (UUID v4)',
    example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  })
  async findByGersId(@Param('gersId') gersId: string) {
    const numero = await this.overtureService.findByGersId(gersId);
    if (!numero) {
      return { found: false, gersId };
    }
    return {
      found: true,
      gersId,
      napId: numero.id,
      banId: numero.banId,
      numero: numero.numero,
      suffixe: numero.suffixe,
      voie: numero.voie?.nom,
      commune: numero.baseLocale?.commune,
      positions: numero.positions,
    };
  }

  @Post('link/numero/:numeroId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link a GERS ID to an address (numero)',
    description:
      'Associates an Overture Maps GERS ID with an existing NAP address point. ' +
      'This establishes a stable cross-reference for bidirectional data quality.',
  })
  @ApiParam({ name: 'numeroId', description: 'NAP address (numero) ID' })
  async linkGersToNumero(
    @Param('numeroId') numeroId: string,
    @Body() body: LinkGersDTO,
  ) {
    const numero = await this.overtureService.linkGersToNumero(
      numeroId,
      body.gersId,
      body.overtureSource,
    );
    return {
      success: true,
      id: numero.id,
      gersId: numero.gersId,
      overtureSource: numero.overtureSource,
    };
  }

  @Post('link/voie/:voieId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link a GERS ID to a street (voie)',
    description:
      'Associates an Overture Maps GERS ID with an existing NAP street. ' +
      'Connects NAP streets to Overture transportation segments.',
  })
  @ApiParam({ name: 'voieId', description: 'NAP street (voie) ID' })
  async linkGersToVoie(
    @Param('voieId') voieId: string,
    @Body() body: LinkGersDTO,
  ) {
    const voie = await this.overtureService.linkGersToVoie(
      voieId,
      body.gersId,
    );
    return {
      success: true,
      id: voie.id,
      gersId: voie.gersId,
    };
  }

  @Post('link/toponyme/:toponymeId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link a GERS ID to a place name (toponyme)',
    description:
      'Associates an Overture Maps GERS ID with an existing NAP place name. ' +
      'Connects NAP places to the Overture places dataset.',
  })
  @ApiParam({
    name: 'toponymeId',
    description: 'NAP place name (toponyme) ID',
  })
  async linkGersToToponyme(
    @Param('toponymeId') toponymeId: string,
    @Body() body: LinkGersDTO,
  ) {
    const toponyme = await this.overtureService.linkGersToToponyme(
      toponymeId,
      body.gersId,
    );
    return {
      success: true,
      id: toponyme.id,
      gersId: toponyme.gersId,
    };
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk import Overture Maps addresses into a new LAB',
    description:
      'Creates a new Local Address Base for the given jurisdiction and populates it ' +
      'with address data from Overture Maps. Each address retains its GERS ID for ' +
      'bidirectional data quality exchange. Supports both county-level (5-digit FIPS) ' +
      'and city/town-level (7-digit FIPS) jurisdictions.',
  })
  @ApiBody({ type: BulkImportOvertureDTO })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Import result summary with LAB ID and token',
  })
  async bulkImport(@Body() body: BulkImportOvertureDTO) {
    this.logger.log(
      `Overture bulk import requested: ${body.fipsCode}, ${body.addresses.length} addresses`,
    );

    try {
      const result = await this.overtureService.bulkImportFromOverture(
        body.fipsCode,
        body.addresses,
        body.email,
      );

      return {
        success: true,
        ...result,
        editorUrl: `http://localhost:3000/bal/${result.balId}`,
      };
    } catch (error) {
      this.logger.error(`Overture import failed: ${error.message}`);
      throw new HttpException(
        `Import failed: ${error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('stats/:balId')
  @ApiOperation({
    summary: 'Get GERS linking statistics for a LAB',
    description:
      'Returns the number and percentage of addresses in a Local Address Base ' +
      'that have been linked to Overture GERS IDs.',
  })
  @ApiParam({ name: 'balId', description: 'Local Address Base ID' })
  async getGersStats(@Param('balId') balId: string) {
    return this.overtureService.getGersStats(balId);
  }

  @Get('export/:balId')
  @ApiOperation({
    summary: 'Export addresses in Overture-compatible format',
    description:
      'Exports all addresses from a LAB in a format suitable for contributing ' +
      'to the Overture Maps Foundation. Includes GERS IDs where linked.',
  })
  @ApiParam({ name: 'balId', description: 'Local Address Base ID' })
  @ApiQuery({
    name: 'countyFips',
    description: '5-digit county FIPS code',
    example: '06037',
  })
  async exportForOverture(
    @Param('balId') balId: string,
    @Query('countyFips') countyFips: string,
  ) {
    const records = await this.overtureService.exportForOverture(
      balId,
      countyFips,
    );
    return {
      count: records.length,
      format: 'overture-addresses-v1',
      records,
    };
  }
}
