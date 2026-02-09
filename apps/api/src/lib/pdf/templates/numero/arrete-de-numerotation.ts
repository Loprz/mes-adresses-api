import { PdfDocument, xMargin } from '../../PDFDocument';
import { Numero } from '@/shared/entities/numero.entity';
import { BaseLocale } from '@/shared/entities/base_locale.entity';
import { Voie } from '@/shared/entities/voie.entity';
import { Toponyme } from '@/shared/entities/toponyme.entity';
import { getImageDimensions } from '@/lib/utils/image.utils';

type ArreteDeNumerotationParams = {
  baseLocale: BaseLocale;
  numero: Numero;
  voie: Voie;
  toponyme?: Toponyme;
  planDeSituation?: Express.Multer.File;
};

export async function generateArreteDeNumerotation(
  params: ArreteDeNumerotationParams,
): Promise<string> {
  const { numero, baseLocale, voie, toponyme, planDeSituation } = params;

  let planDeSituationDataUrl = '';
  let planDeSituationDimensions: { width: number; height: number } | null =
    null;
  let imageFormat = '';
  if (planDeSituation) {
    const base64PlanDeSituation = planDeSituation.buffer.toString('base64');
    imageFormat = planDeSituation.mimetype.replace('image/', '');
    if (!['png', 'jpeg', 'jpg'].includes(imageFormat)) {
      throw new Error('Invalid file type. Only PNG and JPEG are allowed.');
    }
    planDeSituationDataUrl = `data:image/${imageFormat};base64,${base64PlanDeSituation}`;
    planDeSituationDimensions = await getImageDimensions(
      planDeSituationDataUrl,
    );
  }

  const doc = new PdfDocument();
  const maxWidth = doc.getDocInstance().internal.pageSize.width - 2 * xMargin;

  await doc.initDocument('Street Numbering Order', {
    nom: baseLocale.communeNom,
    code: baseLocale.commune,
  });

  doc
    .addText(`The Jurisdiction Authority of ${baseLocale.communeNom},`, {
      align: 'left',
    })
    .addText(
      `Pursuant to the authority granted under applicable state and local addressing ordinances,`,
      {
        align: 'justify',
        maxWidth,
      },
    )
    .addText(
      `Whereas the numbering of structures within the jurisdiction is a public safety measure necessary for emergency response, mail delivery, and utility services,`,
      {
        align: 'justify',
        maxWidth,
      },
    )
    .addText(
      `Whereas consistent and accurate address numbering benefits residents, businesses, and public services,`,
      {
        align: 'justify',
        maxWidth,
      },
    )
    .addText(
      `Whereas the initial numbering of addresses is the responsibility of the jurisdiction,`,
      {
        align: 'justify',
        maxWidth,
      },
    )
    .addNewLine()
    .changeFontSize(20)
    .addText(`IT IS HEREBY ORDERED:`, {
      align: 'center',
    })
    .changeFontSize(12)
    .addNewLine()
    .addText(
      `Section 1: The following address numbering is prescribed (see plan below):`,
      {
        align: 'justify',
      },
    )
    .addGenericTable(
      ['Full Address', 'Parcel Number(s)'],
      [
        [
          `${numero.numeroComplet} ${voie.nom}${
            toponyme ? `\n${toponyme.nom}` : ''
          }\n${baseLocale.communeNom}`,
          numero.parcelles.join(', ') || '-',
        ],
      ],

      {},
    );

  if (planDeSituation) {
    doc
      .addNewPage()
      .addNewLine()
      .addText('Site Plan:', { align: 'left' })
      .addImage(planDeSituationDataUrl, imageFormat as 'png' | 'jpeg' | 'jpg', {
        width: maxWidth,
        height:
          planDeSituationDimensions.height *
          (maxWidth / planDeSituationDimensions.width),
      });
  }

  return doc.render();
}
