import { PdfDocument } from '../../PDFDocument';
import { Numero } from '@/shared/entities/numero.entity';
import { BaseLocale } from '@/shared/entities/base_locale.entity';
import { Voie } from '@/shared/entities/voie.entity';
import { Toponyme } from '@/shared/entities/toponyme.entity';
import { GenerateCertificatDTO } from '@/modules/numeros/dto/generate_certificat.dto';

type CertificatAdressageParams = {
  baseLocale: BaseLocale;
  numero: Numero;
  voie: Voie;
  toponyme?: Toponyme;
} & GenerateCertificatDTO;

export async function generateCertificatAdressage(
  params: CertificatAdressageParams,
): Promise<string> {
  const { numero, baseLocale, voie, toponyme, emetteur, destinataire } = params;

  const doc = new PdfDocument();
  await doc.initDocument('Address Certificate', {
    nom: baseLocale.communeNom,
    code: baseLocale.commune,
  });

  return doc
    .addText(
      `${
        emetteur
          ? `I, the undersigned ${emetteur}, certify that `
          : `The Jurisdiction Authority of ${baseLocale.communeNom} certifies that `
      }${
        destinataire
          ? `the property belonging to ${destinataire} designated below `
          : `the address designated below `
      }is certified in the Local Address Base of ${baseLocale.communeNom}.`,
      { align: 'left' },
    )
    .addGenericTable(
      [
        'Street number and street name',
        'Parcel number(s)',
      ],
      [
        [
          `${numero.numeroComplet} ${voie.nom}${
            toponyme ? `\n${toponyme.nom}` : ''
          }\n${baseLocale.communeNom}`,
          numero.parcelles.join(', '),
        ],
      ],

      {},
    )
    .addNewLine()
    .addNewLine()
    .addText(
      'In witness whereof, this certificate is issued to the applicant for all lawful purposes.',
      { align: 'left' },
    )
    .addText(
      'This certificate does not constitute: a building permit, right of way, easement, proof of property ownership, or certificate of residency.',
      { align: 'left' },
    )
    .render();
}
