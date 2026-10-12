// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { edFetch } from '../../core/fetch';
import { assertPositiveInteger } from '../../core/validate';
import { postOptions, requireCurrentAccount } from '../../core/request';
import { readResource } from '../../core/cache';
import type { EdContext } from '../../core/context';

export interface QcmOptions {
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

export interface SubmitQcmAnswerParams {
  idQcm: number;
  idAssociation: number;
  idParticipant: number;
  idReponse: number;
  idQuestion: number;
  choiceIds: number[];
}

/**
 * QCM (forms) namespace (no module check: EcoleDirecte exposes no verified module code for it).
 *
 * @example
 * ```ts
 * const qcms = await ld.qcms.getQcms();
 * ```
 */
/** Validate the (idQcm, idAssociation, idParticipant) triple every QCM call needs. */
function assertQcmIds(idQcm: number, idAssociation: number, idParticipant: number): void {
  assertPositiveInteger(idQcm, 'idQcm');
  assertPositiveInteger(idAssociation, 'idAssociation');
  assertPositiveInteger(idParticipant, 'idParticipant');
}

export class QcmsNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * List available QCMs.
   *
   * @example
   * ```ts
   * const qcms = await ld.qcms.getQcms();
   * ```
   */
  getQcms = async (options: QcmOptions = {}): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    const endpoint = `/eleves/${account.id}/qcms/0/associations.awp?verbe=get`;
    return readResource<any>(this.ctx, 'qcms', endpoint, {
      accountId: account.id,
      suffix: 'list',
      mockMode: options.mockMode,
      force: options.force,
    });
  };

  /**
   * Fetch one QCM's questions and answers.
   *
   * @example
   * ```ts
   * const detail = await ld.qcms.getQcmDetail(149, 237);
   * ```
   */
  getQcmDetail = async (
    idQcm: number,
    idAssociation: number,
    options: QcmOptions = {},
  ): Promise<any> => {
    assertPositiveInteger(idQcm, 'idQcm');
    assertPositiveInteger(idAssociation, 'idAssociation');
    const account = requireCurrentAccount(this.ctx);
    const endpoint = `/eleves/${account.id}/qcms/${idQcm}/associations/${idAssociation}.awp?verbe=get`;
    const body = { anneeQCMs: '' };
    return readResource<any>(this.ctx, 'qcms', endpoint, {
      accountId: account.id,
      suffix: `detail.${idQcm}.${idAssociation}`,
      body,
      mockMode: options.mockMode,
      force: options.force,
    });
  };

  /**
   * Start or finish a QCM attempt.
   *
   * @example
   * ```ts
   * await ld.qcms.updateQcmStatus(149, 237, 5904, 'updateStartDate');
   * ```
   */
  updateQcmStatus = async (
    idQcm: number,
    idAssociation: number,
    idParticipant: number,
    action: 'updateStartDate' | 'updateEndDate',
    options: QcmOptions = {},
  ): Promise<{ success: boolean }> => {
    assertQcmIds(idQcm, idAssociation, idParticipant);
    const account = requireCurrentAccount(this.ctx);
    const endpoint = `/eleves/${account.id}/qcms/${idQcm}/associations/${idAssociation}/participants/${idParticipant}.awp?verbe=patch`;
    return edFetch<{ success: boolean }>(
      this.ctx,
      endpoint,
      postOptions({ action }, { mockMode: options.mockMode }),
    );
  };

  /**
   * Submit an answer to a QCM question.
   *
   * @example
   * ```ts
   * await ld.qcms.submitQcmAnswer({ idQcm: 149, idAssociation: 237, idParticipant: 5904, idReponse: 91943, idQuestion: 2819, choiceIds: [12922] });
   * ```
   */
  submitQcmAnswer = async (
    params: SubmitQcmAnswerParams,
    options: QcmOptions = {},
  ): Promise<{ success: boolean }> => {
    assertQcmIds(params.idQcm, params.idAssociation, params.idParticipant);
    assertPositiveInteger(params.idReponse, 'idReponse');
    assertPositiveInteger(params.idQuestion, 'idQuestion');
    const account = requireCurrentAccount(this.ctx);
    const endpoint = `/eleves/${account.id}/qcms/${params.idQcm}/associations/${params.idAssociation}/participants/${params.idParticipant}/reponse/${params.idReponse}.awp?verbe=patch`;
    return edFetch<{ success: boolean }>(
      this.ctx,
      endpoint,
      postOptions(
        {
          reponse: {
            id: params.idReponse,
            idQuestion: params.idQuestion,
            idParticipant: params.idParticipant,
            choix: params.choiceIds,
          },
        },
        { mockMode: options.mockMode },
      ),
    );
  };
}
